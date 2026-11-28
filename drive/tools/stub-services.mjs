// Local stand-ins for the Claude API and Tessie, for `npm run dev:mock` and
// the smoke test. They speak the same wire formats as the real services, so
// the app's real client code runs unchanged against them and no API credit
// is spent.
//
// Scenarios are picked by text in the last user message:
//   [refuse]  the model declines before writing anything
//   [pause]   a search turn pauses once and is resumed
//   [badreq]  the API answers 400
//   [slow]    a long answer, for testing Stop
//   [html]    an answer containing markup the page must not execute

import http from "node:http";

const requests = [];

const ANSWER = `**Short version:** stocks are a touch higher and nothing here needs action.

## What moved
- S&P 500 up **0.4%**, Nasdaq up 0.6% as of 1:55 PM ET
- Bitcoin near 97,200, flat on the day
- Yields eased after the morning data

| Index | Move | Note |
|---|---|---|
| S&P 500 | +0.4% | Broad gains |
| Nasdaq | +0.6% | Chips led |

Run \`status\` again after the close for the final print, or read the [full wrap](https://example.com/markets).`;

const BRIEF = `## Markets
- S&P 500 up 0.4% and Nasdaq up 0.6% as of 1:55 PM ET
- Bitcoin near 97,200, flat on the day

## On deck
- PCE inflation data at 8:30 AM ET tomorrow
- Two large-cap earnings reports after the close

## Fleet
- Model Y Long Range is **unlocked** at Home
- Model 3 Performance is charging, 25 min to its limit`;

const HOSTILE = 'Before <img src=x onerror="window.__pwned=1"> after. **bold** and [bad](javascript:window.__pwned=1) and [good](https://example.com/ok).';

const LONG = Array.from({ length: 60 }, (_, i) => "Line " + (i + 1) + " of a deliberately long answer.").join("\n\n");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUserText(body) {
  const users = (body.messages || []).filter((m) => m.role === "user");
  const last = users[users.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content.map((b) => b.text || "").join(" ");
}

async function streamMessage(req, res, body, record) {
  const text = lastUserText(body);
  const tail = body.messages[body.messages.length - 1];
  const resumed = tail && tail.role === "assistant";

  if (text.includes("[badreq]")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stub bad request" } }));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let open = true;
  res.on("close", () => {
    open = false;
    // Lets the smoke test confirm that Stop reaches the upstream call.
    if (!res.writableEnded) record.aborted = true;
  });
  const emit = (data) => open && res.write("event: " + data.type + "\ndata: " + JSON.stringify(data) + "\n\n");
  let index = 0;

  emit({
    type: "message_start",
    message: {
      id: "msg_stub",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1 },
    },
  });

  const finish = (stopReason, usage) => {
    emit({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage });
    emit({ type: "message_stop" });
    res.end();
  };

  if (text.includes("[refuse]")) {
    finish("refusal", { output_tokens: 0 });
    return;
  }

  const search = async () => {
    emit({ type: "content_block_start", index, content_block: { type: "server_tool_use", id: "srvtoolu_stub", name: "web_search", input: {} } });
    emit({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: '{"query":"markets today"}' } });
    emit({ type: "content_block_stop", index });
    index += 1;
    await sleep(250);
  };

  if (!resumed) {
    emit({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
    await sleep(200);
    emit({ type: "content_block_stop", index });
    index += 1;
  }

  if (text.includes("[pause]") && !resumed) {
    await search();
    finish("pause_turn", { output_tokens: 20 });
    return;
  }

  const brief = /daily brief/i.test(text);
  const searched = !resumed && (brief || /market|news|headline|search|earnings/i.test(text));
  if (searched) {
    await search();
    emit({
      type: "content_block_start",
      index,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_stub",
        content: [
          { type: "web_search_result", url: "https://example.com/markets", title: "Markets wrap", encrypted_content: "stub", page_age: null },
          { type: "web_search_result", url: "https://example.org/calendar", title: "Economic calendar", encrypted_content: "stub", page_age: null },
        ],
      },
    });
    emit({ type: "content_block_stop", index });
    index += 1;
  }

  const answer = text.includes("[html]") ? HOSTILE : text.includes("[slow]") ? LONG : brief ? BRIEF : resumed ? "Resumed after the pause and finished the answer." : ANSWER;
  emit({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: searched ? [] : null } });
  for (const piece of answer.match(/[\s\S]{1,14}/g)) {
    if (!open) return;
    emit({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
    await sleep(text.includes("[slow]") ? 40 : 12);
  }
  if (searched) {
    emit({
      type: "content_block_delta",
      index,
      delta: {
        type: "citations_delta",
        citation: { type: "web_search_result_location", url: "https://example.com/markets", title: "Markets wrap", encrypted_index: "stub", cited_text: "S&P 500 up 0.4%" },
      },
    });
  }
  emit({ type: "content_block_stop", index });
  finish("end_turn", { output_tokens: 180, server_tool_use: { web_search_requests: searched ? 1 : 0 } });
}

// Shaped like Tessie's documented GET /vehicles response. Values use Tesla's
// native units: miles, Celsius, bar.
function fleet() {
  const now = Date.now();
  const car = (vin, name, o) => ({
    vin,
    is_active: true,
    last_state: {
      vin,
      display_name: name,
      state: o.state || "online",
      charge_state: {
        battery_level: o.battery,
        usable_battery_level: o.battery,
        battery_range: o.range,
        charge_limit_soc: o.limit,
        charging_state: o.charging || "Disconnected",
        minutes_to_full_charge: o.minutes || 0,
        charger_power: o.power || 0,
        timestamp: now - o.age,
      },
      drive_state: { latitude: o.lat, longitude: o.lon, shift_state: o.shift || null, speed: null, timestamp: now - o.age },
      climate_state: { inside_temp: o.inside, outside_temp: 17.2, is_climate_on: false, timestamp: now - o.age },
      vehicle_state: {
        locked: o.locked,
        sentry_mode: o.sentry,
        odometer: o.odometer,
        car_version: "2026.38.5.11 abcdef123456",
        tpms_pressure_fl: 2.9,
        tpms_pressure_fr: 2.9,
        tpms_pressure_rl: 2.85,
        tpms_pressure_rr: 2.9,
        timestamp: now - o.age,
      },
      gui_settings: { gui_distance_units: "mi/hr", gui_temperature_units: "F" },
    },
  });
  return {
    results: [
      car("5YJ3STUB000000001", "Model 3 Performance", { battery: 64, range: 202.4, limit: 100, charging: "Charging", minutes: 25, power: 44, lat: 37.3947, lon: -122.1503, inside: 23.3, locked: false, sentry: false, odometer: 48211.6, age: 60_000 }),
      car("7SAYSTUB000000002", "Model Y Long Range", { battery: 78, range: 241.1, limit: 80, lat: 37.2358, lon: -121.8053, inside: 18.1, locked: false, sentry: true, odometer: 31004.2, age: 4 * 60_000 }),
      car("5YJ3STUB000000003", "Model 3 Standard", { state: "asleep", battery: 17, range: 41.7, limit: 90, lat: 37.3382, lon: -121.8863, inside: 15.0, locked: true, sentry: false, odometer: 67120.9, age: 3 * 3600_000 }),
    ],
  };
}

const PLACES = {
  "5YJ3STUB000000001": { latitude: 37.3947, longitude: -122.1503, address: "3000 Example Ave, Palo Alto, California 94304, United States", saved_location: "Supercharger" },
  "7SAYSTUB000000002": { latitude: 37.2358, longitude: -121.8053, address: "100 Sample St, San Jose, California 95123, United States", saved_location: "Home" },
  "5YJ3STUB000000003": { latitude: 37.3382, longitude: -121.8863, address: "55 Placeholder Blvd, San Jose, California 95113, United States", saved_location: "" },
};

// A third of a second of silence as a valid WAV, standing in for speech audio.
function shortWav() {
  const samples = 2700;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0, "latin1");
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8, "latin1");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "latin1");
  wav.writeUInt32LE(samples, 40);
  return wav;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

export function startStubs(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const sendJson = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (url.pathname === "/__requests") {
      if (req.method === "DELETE") requests.length = 0;
      return sendJson(200, requests);
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const body = JSON.parse(await readBody(req));
      const record = { service: "claude", path: url.pathname + url.search, key: req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer /, ""), beta: req.headers["anthropic-beta"] || "", body, aborted: false };
      requests.push(record);
      return streamMessage(req, res, body, record);
    }
    if (req.method === "POST" && url.pathname === "/v4/ai/speech-model") {
      const body = JSON.parse(await readBody(req));
      requests.push({ service: "speech", model: req.headers["ai-model-id"] || "", key: (req.headers.authorization || "").replace(/^Bearer /, ""), body });
      return sendJson(200, { audio: shortWav().toString("base64"), warnings: [] });
    }
    if (req.method === "GET" && url.pathname === "/vehicles") {
      requests.push({ service: "tessie", path: url.pathname + url.search, auth: req.headers.authorization || "" });
      return sendJson(200, fleet());
    }
    const place = url.pathname.match(/^\/([^/]+)\/location$/);
    if (req.method === "GET" && place && PLACES[place[1]]) {
      requests.push({ service: "tessie", path: url.pathname });
      return sendJson(200, PLACES[place[1]]);
    }
    sendJson(404, { error: "not found" });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
