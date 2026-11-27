// End-to-end smoke test: `npm test`.
//
// Starts the dev server against the local stubs, then checks the API routes
// and (when Playwright is installed) drives the real page at car and phone
// sizes. Nothing here calls a paid service.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PASS = "246810";
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log((condition ? "  ok    " : "  FAIL  ") + name + (condition || !detail ? "" : "  [" + detail + "]"));
}

function startServer(port, stubPort, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dev-server.mjs", "--mock"], {
      cwd: root,
      env: { ...process.env, PORT: String(port), STUB_PORT: String(stubPort), DRIVE_PASSCODE: PASS, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const onData = (chunk) => {
      log += chunk;
      if (log.includes("drive console on")) resolve(child);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("exit", (code) => reject(new Error("dev server exited early (" + code + "):\n" + log)));
    setTimeout(() => reject(new Error("dev server did not start:\n" + log)), 8000);
  });
}

const auth = (extra = {}) => ({ Authorization: "Bearer " + PASS, ...extra });

async function chat(base, body, headers = auth()) {
  const response = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const events = response.headers.get("content-type").includes("ndjson")
    ? text.trim().split("\n").map((line) => JSON.parse(line))
    : [];
  return { status: response.status, events, text, answer: events.filter((e) => e.t === "delta").map((e) => e.v).join("") };
}

const ask = (content, extra = {}) => ({ messages: [{ role: "user", content }], ...extra });

async function upstream(stub, reset = false) {
  const response = await fetch(stub + "/__requests", { method: reset ? "DELETE" : "GET" });
  return (await response.json()).filter((r) => r.service === "claude");
}

async function apiChecks(base, stub) {
  console.log("\nAPI");
  check("no passcode is rejected", (await fetch(base + "/api/session")).status === 401);
  check("wrong passcode is rejected", (await fetch(base + "/api/session", { headers: { Authorization: "Bearer 000000" } })).status === 401);

  const session = await (await fetch(base + "/api/session", { headers: auth() })).json();
  check("session lists three models", session.ok && session.models.length === 3 && session.defaultModel === "claude-opus-5-5");

  const fleet = await (await fetch(base + "/api/fleet", { headers: auth() })).json();
  const car = fleet.vehicles[0];
  check("fleet returns three cars", fleet.configured && fleet.vehicles.length === 3);
  check("fleet converts units", car.battery === 64 && car.range === 202 && car.insideTemp === 74 && car.tires.fl === 42, JSON.stringify(car));
  check("fleet reads status and place", car.status === "Charging" && car.minutesToFull === 25 && car.savedLocation === "Supercharger" && fleet.vehicles[2].status === "Asleep");
  check("fleet hides VIN and coordinates", !("vin" in car) && !("lat" in car) && !("lon" in car));

  await upstream(stub, true);
  const opus = await chat(base, ask("market pulse", { model: "claude-opus-5-5", timeZone: "America/Los_Angeles" }));
  const statuses = opus.events.filter((e) => e.t === "status").map((e) => e.v).join(",");
  const done = opus.events[opus.events.length - 1];
  check("chat streams status then text", statuses === "thinking,searching,writing" && opus.answer.includes("Short version"), statuses);
  check("chat ends with sources and usage", done.t === "done" && done.sources[0].url === "https://example.com/markets" && done.usage.searches === 1 && done.usage.output === 180, JSON.stringify(done));

  let sent = (await upstream(stub))[0];
  const live = sent.body.system[1].text;
  check("opus request opts into refusal fallback", sent.beta.includes("server-side-fallback-2026-07-01") && sent.body.fallbacks === "default" && sent.body.model === "claude-opus-5-5" && sent.key === "stub-key");
  check("request uses web search, low effort, cached system", sent.body.tools[0].type === "web_search_20260209" && sent.body.tools[0].max_uses === 3 && sent.body.output_config.effort === "low" && sent.body.system[0].cache_control.type === "ephemeral" && sent.body.thinking === undefined);
  check("live context rides in its own system block", sent.body.system.length === 2 && live.includes("Fleet snapshot from Tessie") && live.includes("America/Los_Angeles") && live.includes("glance") && sent.body.messages.length === 1);
  check("search is located by time zone only", JSON.stringify(sent.body.tools[0].user_location) === JSON.stringify({ type: "approximate", timezone: "America/Los_Angeles" }));

  await upstream(stub, true);
  await chat(base, ask("hello", { model: "claude-haiku-5-5", timeZone: "Not/AZone" }));
  sent = (await upstream(stub))[0];
  check("haiku request sends no fallback fields", sent.body.fallbacks === undefined && !sent.beta && sent.body.tools[0].user_location === undefined);

  await upstream(stub, true);
  await chat(base, ask("hello", { depth: "deep", length: "detailed" }));
  await chat(base, ask("Daily brief", { kind: "brief" }));
  await chat(base, ask("hello", { model: "made-up-model" }));
  const [deep, brief, fallbackModel] = await upstream(stub);
  check("deep raises effort, searches and room", deep.body.output_config.effort === "high" && deep.body.tools[0].max_uses === 6 && deep.body.max_tokens === 32000);
  check("brief swaps in the server-written request", brief.body.output_config.effort === "medium" && brief.body.messages[0].content.startsWith("Give me my daily brief"));
  check("unknown model falls back to the default", fallbackModel.body.model === "claude-opus-5-5");

  const refused = await chat(base, ask("[refuse] hello"));
  check("refusal is surfaced", refused.events.some((e) => e.t === "refusal") && refused.events[refused.events.length - 1].t === "done");

  await upstream(stub, true);
  const paused = await chat(base, ask("[pause] look this up"));
  const hops = await upstream(stub);
  check("paused search turn is resumed", hops.length === 2 && hops[1].body.messages[hops[1].body.messages.length - 1].role === "assistant" && paused.answer.includes("Resumed"), "hops " + hops.length);

  const bad = await chat(base, ask("[badreq] hello"));
  check("upstream 400 becomes a readable error", bad.events.some((e) => e.t === "error" && e.v.includes("rejected the request")), bad.text);

  check("empty conversation is a 400", (await chat(base, { messages: [] })).status === 400);
  check("conversation must end with the user", (await chat(base, { messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] })).status === 400);
  check("oversized message is a 400", (await chat(base, ask("x".repeat(13000)))).status === 400);
  check("GET on chat is a 405", (await fetch(base + "/api/chat", { headers: auth() })).status === 405);

  // Uses its own client address so the lockout doesn't spill into later checks.
  const stranger = { "X-Forwarded-For": "203.0.113.9" };
  let last = 0;
  for (let i = 0; i < 9; i++) {
    last = (await fetch(base + "/api/session", { headers: { Authorization: "Bearer 111111", ...stranger } })).status;
  }
  check("repeated wrong passcodes lock that client out", last === 429);
  check("lockout holds even with the right passcode", (await fetch(base + "/api/session", { headers: auth(stranger) })).status === 429);
  check("other clients are unaffected", (await fetch(base + "/api/session", { headers: auth() })).status === 200);
}

async function configChecks() {
  console.log("\nConfiguration");
  const noFleet = await startServer(4331, 4332, { MOCK_FLEET: "off" });
  try {
    const base = "http://localhost:4331";
    const session = await (await fetch(base + "/api/session", { headers: auth() })).json();
    const fleet = await (await fetch(base + "/api/fleet", { headers: auth() })).json();
    check("without Tessie the fleet reports not configured", session.fleet === false && fleet.configured === false);
    await chat(base, ask("where are my cars"));
    const sent = (await upstream("http://127.0.0.1:4332"))[0];
    check("without Tessie the model is told so", sent.body.system[1].text.includes("Fleet snapshot: not connected"));
  } finally {
    noFleet.kill();
  }

  const viaKey = await startServer(4351, 4352, { MOCK_PROVIDER: "gateway" });
  try {
    const base = "http://localhost:4351";
    const session = await (await fetch(base + "/api/session", { headers: auth() })).json();
    const reply = await chat(base, ask("market pulse", { model: "claude-sonnet-5-5" }));
    const sent = (await upstream("http://127.0.0.1:4352"))[0];
    check("gateway mode is reported and answers", session.claude === true && session.provider === "gateway" && reply.answer.includes("Short version"));
    check("gateway request uses its model ids, basic search and no fallback fields", sent.body.model === "anthropic/claude-sonnet-5.5" && sent.body.tools[0].type === "web_search_20250305" && sent.body.fallbacks === undefined && !sent.beta && sent.path === "/v1/messages" && sent.key === "stub-gateway-key", JSON.stringify({ model: sent.body.model, path: sent.path, beta: sent.beta }));
  } finally {
    viaKey.kill();
  }

  const viaOidc = await startServer(4361, 4362, { MOCK_PROVIDER: "oidc" });
  try {
    const base = "http://localhost:4361";
    const bare = await (await fetch(base + "/api/session", { headers: auth() })).json();
    const refused = await chat(base, ask("hello"));
    check("with no key and no token Claude reads as not connected", bare.claude === false && refused.status === 503);
    const token = { "x-vercel-oidc-token": "stub-oidc-token" };
    const session = await (await fetch(base + "/api/session", { headers: auth(token) })).json();
    await chat(base, ask("hello"), auth(token));
    const sent = (await upstream("http://127.0.0.1:4362"))[0];
    check("the per-request Vercel token authenticates gateway calls", session.provider === "gateway" && sent.key === "stub-oidc-token" && sent.body.model === "anthropic/claude-opus-5.5");
  } finally {
    viaOidc.kill();
  }

  const noPass = await startServer(4341, 4342, { DRIVE_PASSCODE: "abc" });
  try {
    const response = await fetch("http://localhost:4341/api/session", { headers: auth() });
    check("a missing or malformed passcode config fails closed", response.status === 503 && (await response.json()).error === "not_configured");
  } finally {
    noPass.kill();
  }
}

async function browserChecks(base, stub) {
  console.log("\nBrowser");
  let chromium;
  try {
    chromium = createRequire(import.meta.url)("playwright").chromium;
  } catch {
    console.log("  skipped: Playwright is not installed (npm i -D playwright to run these)");
    return;
  }
  const browser = await chromium.launch();
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1180, height: 860 } });
  const page = await context.newPage();
  // The wrong-PIN step below makes the browser log its expected 401.
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("401 (Unauthorized)") && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));

  const enterPin = async (pin) => {
    for (const digit of pin) await page.click(`#keypad [data-key="${digit}"]`);
    await page.click("#unlock");
  };
  const answerDone = () => page.waitForFunction(() => !document.querySelector("#send").classList.contains("is-stop"));
  const send = async (text) => {
    await page.fill("#input", text);
    await page.press("#input", "Enter");
  };
  const lastAnswer = () => page.locator(".msg-ai").last();

  try {
    await page.goto(base);
    await enterPin("999999");
    await page.waitForFunction(() => document.querySelector("#lock-msg").textContent === "Wrong passcode");
    check("wrong PIN shows an error and stays locked", await page.isVisible("#lock"));
    await enterPin(PASS);
    await page.waitForSelector(".car");
    check("home shows tiles, fleet and mode", (await page.locator(".tile").count()) === 8 && (await page.locator(".car").count()) === 3 && (await page.textContent("#mode-chip")).includes("Opus 5.5"));

    await page.click(".tile >> nth=0");
    await page.waitForSelector("#followups .btn");
    check("tile opens chat with a formatted answer", (await page.locator(".msg-ai .prose table").count()) === 1 && (await page.locator(".msg-ai .prose strong").count()) >= 1 && (await page.locator(".source").count()) === 1 && (await page.locator("#followups .btn").count()) === 3);

    await upstream(stub, true);
    await page.click("#followups .btn >> nth=0");
    await answerDone();
    const followup = (await upstream(stub))[0];
    check("follow-up sends the conversation so far", followup.body.messages.map((m) => m.role).join(",") === "user,assistant,user", followup.body.messages.map((m) => m.role).join(","));

    await upstream(stub, true);
    await send("[slow] long one");
    await page.waitForFunction(() => document.querySelectorAll(".msg-ai")[2] && document.querySelectorAll(".msg-ai")[2].textContent.includes("Line 3"));
    await page.click("#send");
    await answerDone();
    const stopped = await lastAnswer().textContent();
    check("Stop ends a long answer early", stopped.includes("Stopped.") && !stopped.includes("Line 60"));
    await page.waitForTimeout(300);
    check("Stop also cancels the upstream API call", (await upstream(stub))[0].aborted === true);

    await send("[badreq] break");
    await page.waitForSelector("#followups .btn-primary");
    check("an API error offers Try again", (await lastAnswer().textContent()).includes("rejected the request") && (await page.textContent("#followups .btn")) === "Try again");

    await page.click("#nav-new");
    await send("[refuse] anything");
    await answerDone();
    check("a refusal reads as a plain note", (await lastAnswer().textContent()).includes("Claude declined"));

    await send("[html] show me");
    await answerDone();
    const hostile = await page.evaluate(() => ({
      pwned: window.__pwned === 1,
      images: document.querySelectorAll(".msg-ai img").length,
      links: [...document.querySelectorAll(".msg-ai .prose a")].map((a) => a.getAttribute("href")),
    }));
    check("model output cannot inject markup or script links", !hostile.pwned && hostile.images === 0 && hostile.links.length === 1 && hostile.links[0] === "https://example.com/ok", JSON.stringify(hostile));

    await page.click("#nav-home");
    await page.click("#brief-actions .btn");
    await answerDone();
    await page.click("#nav-home");
    check("brief is saved to the home card", (await page.textContent("#brief-meta")).startsWith("Today") && (await page.textContent("#brief-body")).includes("Markets") && (await page.textContent("#brief-actions")).includes("Open"));

    await page.click("#nav-settings");
    await page.click("#seg-model button >> nth=2");
    await page.click("#seg-depth button >> nth=1");
    await page.click("#seg-size button >> nth=2");
    await page.click("#seg-composer button >> nth=0");
    await page.click('.swatch[data-accent="blue"]');
    const look = await page.evaluate(() => ({
      chip: document.querySelector("#mode-chip").textContent,
      size: document.documentElement.getAttribute("data-size"),
      top: document.querySelector("#stage").classList.contains("is-top"),
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      inputWidth: document.querySelector("#input").getBoundingClientRect().width,
      inputTop: document.querySelector("#input").getBoundingClientRect().top,
    }));
    check("settings change the model, size and accent", look.chip.includes("Haiku 5.5") && look.chip.includes("Deep") && look.size === "xl" && look.accent === "#5aa2ff", JSON.stringify(look));
    check("typing box moves to the top at full width", look.top && look.inputTop < 120 && look.inputWidth > 500, JSON.stringify(look));
    check("spend estimate counts answers", (await page.textContent("#spend")).includes("answers on this screen"));

    await page.click("#tile-add");
    await page.fill("#tile-label", "Charge plan");
    await page.fill("#tile-prompt", "Where should I charge next?");
    await page.click("#tile-form .btn-primary");
    await page.click(".sheet-head [data-close]");
    check("a new tile appears on home", (await page.locator(".tile").count()) === 9 && (await page.locator(".tile").last().textContent()).includes("Charge plan"));

    await page.reload();
    await page.waitForSelector(".car");
    const kept = await page.evaluate(() => ({
      tiles: document.querySelectorAll(".tile").length,
      chip: document.querySelector("#mode-chip").textContent,
      messages: document.querySelectorAll(".msg").length,
      locked: !document.querySelector("#lock").hidden,
    }));
    check("reload keeps the unlock, tiles, settings and chat", !kept.locked && kept.tiles === 9 && kept.chip.includes("Haiku") && kept.messages >= 2, JSON.stringify(kept));

    await page.click("#nav-settings");
    await page.click("#lock-now");
    await page.click("#lock-now");
    check("Lock needs two taps, then forgets the passcode", (await page.isVisible("#lock")) && (await page.evaluate(() => localStorage.getItem("drive.pass"))) === null);

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const small = await phone.newPage();
    small.on("pageerror", (e) => problems.push("phone pageerror: " + e.message));
    await small.goto(base);
    for (const digit of PASS) await small.click(`#keypad [data-key="${digit}"]`);
    await small.click("#unlock");
    await small.waitForSelector(".car");
    await small.click(".tile >> nth=0");
    await small.waitForSelector("#followups .btn");
    const spill = await small.evaluate(() =>
      [...document.querySelectorAll(".stage, .composer-row, .tile, .rail, .card, .msg, .bubble, .table-wrap")]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > innerWidth + 1)
        .map((el) => el.className),
    );
    check("nothing runs off a phone-width screen", spill.length === 0, spill.join(" "));
    await phone.close();

    check("no console errors or CSP violations", problems.length === 0, problems.join(" | "));
  } finally {
    await browser.close();
  }
}

const server = await startServer(4321, 4322);
try {
  await apiChecks("http://localhost:4321", "http://127.0.0.1:4322");
  await browserChecks("http://localhost:4321", "http://127.0.0.1:4322");
} finally {
  server.kill();
}
await configChecks();

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + " of " + results.length + " checks passed");
process.exit(failed.length ? 1 : 0);
