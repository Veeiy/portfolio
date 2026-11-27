/*
  Drive console.

  Runs in a Tesla's built-in browser (old Chromium on an Intel Atom), so the
  script is plain and dependency-free: no framework, no build step, and no
  syntax newer than async/await. Everything the driver customizes lives in
  this browser's localStorage; the passcode is the only thing the server
  checks.
*/
(function () {
  "use strict";

  // ---------- Storage ----------

  var KEYS = {
    pass: "drive.pass",
    settings: "drive.settings",
    tiles: "drive.tiles",
    chat: "drive.chat",
    brief: "drive.brief",
    spend: "drive.spend",
    voiceOff: "drive.voiceOff",
  };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Storage can be full or blocked; the app still works for this visit.
    }
  }
  function drop(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Nothing to clean up.
    }
  }

  // ---------- Defaults ----------

  var DEFAULT_TILES = [
    { label: "Market pulse", prompt: "Quick market pulse: S&P 500, Nasdaq and Bitcoin right now, plus the two or three stories moving them." },
    { label: "Earnings watch", prompt: "Which notable companies report earnings today and tomorrow, and what moves are options pricing in?" },
    { label: "Fleet check", prompt: "Fleet status check: battery, charging, where each car is, and anything that needs my attention." },
    { label: "Headlines", prompt: "The five biggest headlines right now, one line each." },
    { label: "Plan my day", prompt: "Help me plan the rest of today. Ask me two quick questions first, then give me a short ordered list." },
    { label: "Think it through", prompt: "I want to pressure-test a decision. Ask me what it is, then challenge my reasoning." },
    { label: "Teach me", prompt: "Teach me one useful idea from tech, markets or business in about 60 seconds." },
    { label: "Explain a warning", prompt: "There is a warning on my Tesla's screen. Ask me what it says, then tell me what it means and what to try." },
  ];
  var MAX_TILES = 12;

  var ACCENTS = { coral: "#e2795a", blue: "#5aa2ff", green: "#3ecf8e", violet: "#a594ff", amber: "#f5b84a" };

  var FOLLOWUPS = [
    { label: "Shorter", prompt: "Give me that again, shorter." },
    { label: "Go deeper", prompt: "Go deeper on that." },
    { label: "Why?", prompt: "Why? Walk me through the reasoning." },
  ];

  var STATUS_TEXT = { connecting: "Connecting", thinking: "Thinking", searching: "Searching the web", writing: "" };

  var HISTORY_LIMIT = 24;
  var STORED_CHAT_LIMIT = 40;
  var FLEET_REFRESH_MS = 5 * 60 * 1000;

  // ---------- State ----------

  var state = {
    pass: load(KEYS.pass, ""),
    session: null,
    settings: Object.assign(
      {
        model: "",
        depth: "quick",
        length: "glance",
        size: window.innerWidth >= 900 ? "l" : "m",
        theme: "dark",
        accent: "coral",
        // Tesla's browser names itself in the user agent. Its keyboard covers
        // the lower screen, so the typing box starts at the top there.
        composer: /Tesla\//.test(navigator.userAgent) ? "top" : "bottom",
      },
      load(KEYS.settings, {})
    ),
    tiles: null,
    messages: [],
    busy: false,
    abort: null,
    lastOptions: null,
    brief: load(KEYS.brief, null),
    pin: "",
    retryStored: false,
    editingTile: -1,
    screen: "home",
  };

  function $(id) {
    return document.getElementById(id);
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- Markdown (escape first, then a small safe subset) ----------

  function esc(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Takes already-escaped text.
  function inline(text) {
    var codes = [];
    text = text.replace(/`([^`\n]+)`/g, function (match, code) {
      codes.push(code);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (match, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[\s(])\*([^*\s][^*\n]*)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    text = text.replace(/(^|[\s(])_([^_\s][^_\n]*)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    return text.replace(/\u0000(\d+)\u0000/g, function (match, index) {
      return "<code>" + codes[Number(index)] + "</code>";
    });
  }

  var LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  var TABLE_ROW = /^\s*\|.*\|\s*$/;
  var TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function cells(row) {
    return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (cell) {
      return inline(esc(cell.trim()));
    });
  }

  function renderMarkdown(source) {
    var lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var para = [];
    var i = 0;

    function flush() {
      if (para.length) {
        out.push("<p>" + para.map(inline).join("<br>") + "</p>");
        para = [];
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        flush();
        var code = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1; // the closing fence, or the end of a still-streaming block
        out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
        continue;
      }

      if (!line.trim()) {
        flush();
        i += 1;
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flush();
        var level = heading[1].length <= 2 ? 3 : heading[1].length === 3 ? 4 : 5;
        out.push("<h" + level + ">" + inline(esc(heading[2].replace(/\s+#+\s*$/, ""))) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        flush();
        out.push("<hr>");
        i += 1;
        continue;
      }

      if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        flush();
        var head = cells(line);
        var rows = [];
        i += 2;
        while (i < lines.length && TABLE_ROW.test(lines[i])) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
            head.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
            "</tr></thead><tbody>" +
            rows.map(function (r) {
              return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
            }).join("") +
            "</tbody></table></div>"
        );
        continue;
      }

      var first = line.match(LIST_ITEM);
      if (first) {
        flush();
        var ordered = /\d/.test(first[2]);
        var start = ordered ? parseInt(first[2], 10) : 1;
        var items = [];
        while (i < lines.length) {
          var item = lines[i].match(LIST_ITEM);
          if (item) {
            items.push({ sub: item[1].length >= 2, text: item[3] });
          } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
            items[items.length - 1].text += " " + lines[i].trim();
          } else {
            break;
          }
          i += 1;
        }
        var tag = ordered ? "ol" : "ul";
        out.push(
          "<" + tag + (ordered && start > 1 ? ' start="' + start + '"' : "") + ">" +
            items.map(function (it) {
              return "<li" + (it.sub ? ' class="sub"' : "") + ">" + inline(esc(it.text)) + "</li>";
            }).join("") +
            "</" + tag + ">"
        );
        continue;
      }

      if (/^\s*>/.test(line)) {
        flush();
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(inline(esc(lines[i].replace(/^\s*>\s?/, ""))));
          i += 1;
        }
        out.push("<blockquote>" + quote.join("<br>") + "</blockquote>");
        continue;
      }

      para.push(esc(line));
      i += 1;
    }
    flush();
    return out.join("");
  }

  // ---------- Server calls ----------

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ Authorization: "Bearer " + state.pass }, options.headers || {});
    return fetch(path, Object.assign({}, options, { headers: headers, cache: "no-store" }));
  }

  async function errorMessage(response) {
    try {
      var data = await response.json();
      if (data && data.message) return data.message;
    } catch (e) {
      // Not JSON; fall through to the generic text.
    }
    return "The server returned an error (" + response.status + ").";
  }

  // Reads newline-delimited JSON events as they arrive.
  async function readEvents(response, onEvent) {
    var buffer = "";
    function drain(final) {
      var parts = buffer.split("\n");
      buffer = final ? "" : parts.pop();
      parts.forEach(function (part) {
        if (!part.trim()) return;
        try {
          onEvent(JSON.parse(part));
        } catch (e) {
          // A malformed line is skipped rather than ending the answer.
        }
      });
    }
    if (!response.body || !response.body.getReader || typeof TextDecoder === "undefined") {
      buffer = await response.text();
      drain(true);
      return;
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      drain(false);
    }
    buffer += decoder.decode();
    drain(true);
  }

  // ---------- Appearance ----------

  function applyAppearance() {
    var root = document.documentElement;
    var theme = state.settings.theme;
    if (theme === "auto") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-size", state.settings.size);
    root.style.setProperty("--accent", ACCENTS[state.settings.accent] || ACCENTS.coral);
    $("stage").className = "stage" + (state.settings.composer === "top" ? " is-top" : "");
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    save(KEYS.settings, state.settings);
    applyAppearance();
    renderSettings();
    renderModeChip();
  }

  function currentModel() {
    var models = (state.session && state.session.models) || [];
    var chosen = models.filter(function (m) { return m.id === state.settings.model; })[0];
    if (chosen) return chosen;
    var fallback = models.filter(function (m) { return m.id === state.session.defaultModel; })[0];
    return fallback || models[0] || { id: "", label: "Claude", price: { input: 0, output: 0 } };
  }

  function renderModeChip() {
    if (!state.session) return;
    $("mode-chip").textContent = currentModel().label + " · " + (state.settings.depth === "deep" ? "Deep" : "Quick");
  }

  // ---------- Lock screen ----------

  function setLockMessage(text, isError) {
    var node = $("lock-msg");
    node.textContent = text;
    node.className = "lock-msg" + (isError ? " is-error" : "");
  }

  function renderPin() {
    var dots = $("dots");
    dots.textContent = "";
    for (var i = 0; i < state.pin.length; i += 1) dots.appendChild(make("span"));
    var button = $("unlock");
    button.textContent = state.retryStored && !state.pin ? "Retry" : "Unlock";
    button.disabled = !(state.pin.length >= 6 || (state.retryStored && !state.pin));
  }

  function showLock() {
    $("lock").hidden = false;
    renderPin();
  }

  function lockNow() {
    stopAnswer();
    drop(KEYS.pass);
    state.pass = "";
    state.pin = "";
    state.retryStored = false;
    closeSheets();
    setLockMessage("Enter your passcode", false);
    showLock();
  }

  function pressKey(key) {
    if (key === "back") state.pin = state.pin.slice(0, -1);
    else if (key === "go") {
      if (state.pin.length >= 6) unlock(state.pin, false);
      else if (state.retryStored && state.pass) unlock(state.pass, true);
      return;
    } else if (state.pin.length < 12) state.pin += key;
    renderPin();
  }

  async function unlock(pin, stored) {
    setLockMessage("Checking", false);
    $("unlock").disabled = true;
    var response;
    try {
      response = await fetch("/api/session", { headers: { Authorization: "Bearer " + pin }, cache: "no-store" });
    } catch (e) {
      state.pin = "";
      state.retryStored = stored;
      setLockMessage("Can't reach the server. Check the connection and try again.", true);
      showLock();
      return;
    }
    state.pin = "";
    if (response.ok) {
      state.session = await response.json();
      state.pass = pin;
      state.retryStored = false;
      save(KEYS.pass, pin);
      enter();
      return;
    }
    if (response.status === 401) {
      drop(KEYS.pass);
      state.pass = "";
      state.retryStored = false;
      setLockMessage(stored ? "Enter your passcode" : "Wrong passcode", !stored);
    } else {
      state.retryStored = stored;
      setLockMessage(await errorMessage(response), true);
    }
    showLock();
  }

  function enter() {
    $("lock").hidden = true;
    state.tiles = load(KEYS.tiles, null) || state.session.tiles || DEFAULT_TILES;
    renderModeChip();
    renderTiles();
    renderBrief();
    renderSettings();
    restoreChat();
    $("cards").className = "cards" + (state.session.fleet ? "" : " is-single");
    $("fleet-card").hidden = !state.session.fleet;
    if (state.session.fleet) loadFleet();
    showScreen("home");
  }

  // ---------- Screens ----------

  function showScreen(name) {
    state.screen = name;
    $("home").hidden = name !== "home";
    $("chat").hidden = name !== "chat";
    if (name === "home") $("nav-home").setAttribute("aria-current", "page");
    else $("nav-home").removeAttribute("aria-current");
    if (name === "chat") $("nav-chat").setAttribute("aria-current", "page");
    else $("nav-chat").removeAttribute("aria-current");
  }

  function tickClock() {
    var now = new Date();
    try {
      $("clock-time").textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now);
      $("clock-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(now);
    } catch (e) {
      $("clock-time").textContent = now.toLocaleTimeString();
      $("clock-date").textContent = now.toDateString();
    }
  }

  function timeLabel(timestamp) {
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
    } catch (e) {
      return new Date(timestamp).toLocaleTimeString();
    }
  }

  function timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      return "";
    }
  }

  // ---------- Home: tiles ----------

  function renderTiles() {
    var grid = $("tiles");
    grid.textContent = "";
    state.tiles.forEach(function (tile) {
      var button = make("button", "tile");
      button.type = "button";
      button.appendChild(make("span", "tile-label", tile.label));
      button.appendChild(make("span", "tile-prompt", tile.prompt));
      button.addEventListener("click", function () {
        ask(tile.prompt, { fresh: true });
      });
      grid.appendChild(button);
    });
  }

  // ---------- Home: daily brief ----------

  function sameDay(a, b) {
    return new Date(a).toDateString() === new Date(b).toDateString();
  }

  function actionButton(label, primary, handler) {
    var button = make("button", "btn" + (primary ? " btn-primary" : ""), label);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }

  function renderBrief() {
    var body = $("brief-body");
    var actions = $("brief-actions");
    var meta = $("brief-meta");
    body.textContent = "";
    actions.textContent = "";
    if (!state.brief || !state.brief.text) {
      meta.textContent = "";
      body.className = "brief-body";
      body.appendChild(make("p", "card-note", "Markets, what's on deck and your fleet, in under a minute of reading."));
      actions.appendChild(actionButton("Get today's brief", true, getBrief));
      return;
    }
    var today = sameDay(state.brief.at, Date.now());
    meta.textContent = (today ? "Today " : "Older, from ") + timeLabel(state.brief.at);
    body.className = "brief-body is-clipped";
    var prose = make("div", "prose");
    prose.innerHTML = renderMarkdown(state.brief.text);
    body.appendChild(prose);
    actions.appendChild(actionButton("Open", today, openBrief));
    actions.appendChild(actionButton("Refresh", !today, getBrief));
  }

  function getBrief() {
    ask("Daily brief", { fresh: true, kind: "brief" });
  }

  function openBrief() {
    newChat();
    pushMessage({ role: "user", content: "Daily brief" });
    pushMessage({ role: "assistant", content: state.brief.text, sources: state.brief.sources || [] });
    persistChat();
    renderTail();
    showScreen("chat");
    $("chat").scrollTop = 0;
  }

  // ---------- Home: fleet ----------

  function placeOf(car) {
    if (car.savedLocation) return car.savedLocation;
    if (car.address) {
      var parts = car.address.split(",");
      return (parts[1] || parts[0]).trim();
    }
    return "";
  }

  function renderFleet(data) {
    var list = $("fleet-list");
    list.textContent = "";
    if (!data.vehicles.length) {
      list.appendChild(make("p", "card-note", "Tessie is connected but reports no active vehicles."));
      return;
    }
    data.vehicles.forEach(function (car) {
      var row = make("button", "car");
      row.type = "button";

      var top = make("span", "car-top");
      top.appendChild(make("span", "car-name", car.name));
      top.appendChild(make("span", "car-pct", car.battery === null ? "--" : car.battery + "%"));
      row.appendChild(top);

      var sub = make("span", "car-sub");
      var left = make("span");
      var bits = [car.status];
      if (car.status === "Charging" && car.minutesToFull) bits.push(car.minutesToFull + " min left");
      var place = placeOf(car);
      if (place) bits.push(place);
      left.textContent = bits.join(" · ");
      if (car.locked === false) {
        left.appendChild(document.createTextNode(" · "));
        left.appendChild(make("span", "car-flag", "Unlocked"));
      }
      sub.appendChild(left);
      sub.appendChild(make("span", "", car.range === null ? "" : car.range + " " + car.units.distance));
      row.appendChild(sub);

      var bar = make("span", "bar");
      var fill = make("span", "bar-fill" + (car.battery !== null && car.battery <= 20 ? " is-low" : car.battery !== null && car.battery <= 40 ? " is-mid" : ""));
      fill.style.display = "block";
      fill.style.width = Math.max(0, Math.min(100, car.battery || 0)) + "%";
      bar.style.display = "block";
      bar.appendChild(fill);
      row.appendChild(bar);

      row.addEventListener("click", function () {
        ask("Status check on " + car.name + ": battery, charging, where it is, and anything that needs my attention.", { fresh: true });
      });
      list.appendChild(row);
    });
  }

  async function loadFleet() {
    var refresh = $("fleet-refresh");
    if (refresh.className.indexOf("is-busy") !== -1) return;
    refresh.className = "icon-btn is-busy";
    try {
      var response = await api("/api/fleet");
      if (response.status === 401) return lockNow();
      if (!response.ok) throw new Error(await errorMessage(response));
      var data = await response.json();
      renderFleet(data);
      $("fleet-meta").textContent = "Updated " + timeLabel(data.fetchedAt);
    } catch (err) {
      var list = $("fleet-list");
      list.textContent = "";
      var failure = err && err.message && err.message.indexOf("Failed to fetch") === -1 ? err.message : "Couldn't load the fleet.";
      list.appendChild(make("p", "card-note is-error", failure));
      $("fleet-meta").textContent = "";
    } finally {
      refresh.className = "icon-btn";
    }
  }

  // ---------- Chat ----------

  function pushMessage(message) {
    state.messages.push(message);
    var node = make("article", "msg " + (message.role === "user" ? "msg-user" : "msg-ai"));
    if (message.role === "user") node.appendChild(make("div", "bubble", message.content));
    else node.appendChild(make("div", "prose"));
    message.node = node;
    var thread = $("thread");
    thread.insertBefore(node, $("followups"));
    if (message.role === "assistant") paint(message);
    $("chat-empty").hidden = true;
    return message;
  }

  function paint(message) {
    var node = message.node;
    node.querySelector(".prose").innerHTML = renderMarkdown(message.content);
    var extras = node.querySelectorAll(".msg-note, .sources");
    for (var i = 0; i < extras.length; i += 1) node.removeChild(extras[i]);

    if (message.sources && message.sources.length) {
      var sources = make("div", "sources");
      message.sources.forEach(function (source) {
        var link = make("a", "source");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        var host = source.url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];
        link.textContent = host;
        link.title = source.title || source.url;
        sources.appendChild(link);
      });
      node.appendChild(sources);
    }
    if (message.note) node.appendChild(make("p", "msg-note", message.note));
    if (message.error) {
      var failure = make("p", "msg-note is-error", message.error + " ");
      node.appendChild(failure);
    }
  }

  var paintTimer = 0;
  function schedulePaint(message) {
    if (paintTimer) return;
    // Repainting a few times a second keeps the Atom responsive while text streams.
    paintTimer = setTimeout(function () {
      paintTimer = 0;
      paint(message);
    }, 120);
  }

  // Follow-up chips and Retry sit under the last answer only.
  function renderTail() {
    var tail = $("followups");
    tail.textContent = "";
    var last = state.messages[state.messages.length - 1];
    if (state.busy || !last || last.role !== "assistant") return;
    if (last.error) {
      tail.appendChild(actionButton("Try again", true, retry));
      return;
    }
    if (!last.content) return;
    FOLLOWUPS.forEach(function (followup) {
      tail.appendChild(actionButton(followup.label, false, function () {
        ask(followup.prompt, {});
      }));
    });
  }

  function persistChat() {
    var kept = state.messages
      .filter(function (m) { return m.content && !m.error; })
      .slice(-STORED_CHAT_LIMIT)
      .map(function (m) {
        return { role: m.role, content: m.content, sources: m.sources || [], note: m.note || "" };
      });
    save(KEYS.chat, kept);
  }

  function restoreChat() {
    clearThread();
    var stored = load(KEYS.chat, []);
    if (Array.isArray(stored)) {
      stored.forEach(function (m) {
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
          pushMessage({ role: m.role, content: m.content, sources: m.sources || [], note: m.note || "" });
        }
      });
    }
    renderTail();
  }

  function clearThread() {
    state.messages = [];
    var thread = $("thread");
    thread.textContent = "";
    var tail = make("div", "followups");
    tail.id = "followups";
    thread.appendChild(tail);
    $("chat-empty").hidden = false;
  }

  function newChat() {
    stopAnswer();
    clearThread();
    drop(KEYS.chat);
  }

  function setBusy(busy) {
    state.busy = busy;
    var button = $("send");
    button.className = "round-btn send-btn" + (busy ? " is-stop" : "");
    button.setAttribute("aria-label", busy ? "Stop" : "Send");
    if (!busy) setStatus("");
  }

  function setStatus(text) {
    $("status").hidden = !text;
    $("status-text").textContent = text;
  }

  function stopAnswer() {
    if (state.abort) state.abort.abort();
  }

  function historyForServer() {
    var usable = state.messages.filter(function (m) {
      return m.content && !m.error && !m.pending;
    });
    usable = usable.slice(-HISTORY_LIMIT);
    while (usable.length && usable[0].role !== "user") usable.shift();
    return usable.map(function (m) {
      return { role: m.role, content: m.content };
    });
  }

  function ask(text, options) {
    text = String(text || "").trim();
    if (!text || state.busy || !state.session) return;
    options = options || {};
    if (options.fresh) newChat();
    showScreen("chat");
    var question = pushMessage({ role: "user", content: text });
    respond(options, question);
  }

  function retry() {
    if (state.busy) return;
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === "assistant" && last.error) {
      state.messages.pop();
      $("thread").removeChild(last.node);
    }
    respond(state.lastOptions || {}, null);
  }

  async function respond(options, question) {
    state.lastOptions = options;
    var history = historyForServer();
    var answer = pushMessage({ role: "assistant", content: "", pending: true });
    var finished = false;
    var controller = typeof AbortController === "undefined" ? null : new AbortController();
    state.abort = controller;
    setBusy(true);
    setStatus(STATUS_TEXT.connecting);
    renderTail();
    if (question) $("chat").scrollTop = Math.max(0, question.node.offsetTop - 10);

    try {
      var response = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          model: currentModel().id,
          depth: state.settings.depth,
          length: state.settings.length,
          kind: options.kind || "chat",
          timeZone: timeZone(),
        }),
        signal: controller ? controller.signal : undefined,
      });
      if (response.status === 401) {
        answer.error = "The passcode is no longer valid.";
        lockNow();
      } else if (!response.ok) {
        answer.error = await errorMessage(response);
      } else {
        await readEvents(response, function (event) {
          if (event.t === "delta") {
            answer.content += event.v;
            schedulePaint(answer);
          } else if (event.t === "status") {
            setStatus(STATUS_TEXT[event.v] || "");
          } else if (event.t === "refusal") {
            answer.content = "";
            answer.note = "Claude declined that one. Try asking it a different way.";
          } else if (event.t === "truncated") {
            answer.note = "That answer was cut off. Ask me to continue.";
          } else if (event.t === "error") {
            answer.error = event.v;
          } else if (event.t === "done") {
            finished = true;
            answer.sources = event.sources || [];
            recordSpend(event.usage);
          }
        });
        if (!finished && !answer.error) answer.error = "The connection dropped before the answer finished.";
      }
    } catch (err) {
      if (err && err.name === "AbortError") answer.note = "Stopped.";
      else answer.error = "Couldn't reach the server. Check the connection and try again.";
    }

    if (paintTimer) {
      clearTimeout(paintTimer);
      paintTimer = 0;
    }
    answer.pending = false;
    state.abort = null;
    paint(answer);
    setBusy(false);
    renderTail();
    persistChat();
    if (options.kind === "brief" && finished && answer.content && !answer.note) {
      state.brief = { text: answer.content, at: Date.now(), sources: answer.sources || [] };
      save(KEYS.brief, state.brief);
      renderBrief();
    }
  }

  // ---------- Spend estimate ----------

  function recordSpend(usage) {
    if (!usage) return;
    var model = currentModel();
    var cost =
      ((usage.input || 0) / 1e6) * model.price.input +
      ((usage.output || 0) / 1e6) * model.price.output +
      (usage.searches || 0) * (state.session.searchPrice || 0);
    var month = new Date().toISOString().slice(0, 7);
    var spend = load(KEYS.spend, null);
    if (!spend || spend.month !== month) spend = { month: month, cost: 0, answers: 0 };
    spend.cost += cost;
    spend.answers += 1;
    save(KEYS.spend, spend);
  }

  // ---------- Settings ----------

  function buildSegment(id, options, current, onPick) {
    var container = $(id);
    container.textContent = "";
    options.forEach(function (option) {
      var button = make("button", "", option.label);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(option.value === current));
      if (option.note) button.appendChild(make("small", "", option.note));
      button.addEventListener("click", function () {
        onPick(option.value);
      });
      container.appendChild(button);
    });
  }

  function renderSettings() {
    if (!state.session) return;
    buildSegment(
      "seg-model",
      state.session.models.map(function (m) { return { value: m.id, label: m.label, note: m.note }; }),
      currentModel().id,
      function (value) { setSetting("model", value); }
    );
    buildSegment("seg-depth", [{ value: "quick", label: "Quick" }, { value: "deep", label: "Deep" }], state.settings.depth, function (value) { setSetting("depth", value); });
    buildSegment(
      "seg-length",
      [{ value: "glance", label: "Glance" }, { value: "normal", label: "Normal" }, { value: "detailed", label: "Detailed" }],
      state.settings.length,
      function (value) { setSetting("length", value); }
    );
    buildSegment("seg-size", [{ value: "m", label: "M" }, { value: "l", label: "L" }, { value: "xl", label: "XL" }], state.settings.size, function (value) { setSetting("size", value); });
    buildSegment("seg-composer", [{ value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }], state.settings.composer, function (value) { setSetting("composer", value); });
    buildSegment(
      "seg-theme",
      [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "auto", label: "Auto" }],
      state.settings.theme,
      function (value) { setSetting("theme", value); }
    );

    var swatches = $("swatches");
    swatches.textContent = "";
    Object.keys(ACCENTS).forEach(function (name) {
      var swatch = make("button", "swatch");
      swatch.type = "button";
      swatch.setAttribute("role", "radio");
      swatch.setAttribute("data-accent", name);
      swatch.setAttribute("aria-label", name);
      swatch.setAttribute("aria-checked", String(name === state.settings.accent));
      swatch.addEventListener("click", function () { setSetting("accent", name); });
      swatches.appendChild(swatch);
    });

    var list = $("tile-list");
    list.textContent = "";
    (state.tiles || []).forEach(function (tile, index) {
      var row = make("button", "tile-row");
      row.type = "button";
      row.appendChild(make("span", "", tile.label));
      row.appendChild(make("em", "", "Edit"));
      row.addEventListener("click", function () { openTileEditor(index); });
      list.appendChild(row);
    });
    $("tile-add").disabled = (state.tiles || []).length >= MAX_TILES;

    var spend = load(KEYS.spend, null);
    var month = new Date().toISOString().slice(0, 7);
    $("spend").textContent =
      spend && spend.month === month
        ? "About $" + spend.cost.toFixed(2) + " this month from " + spend.answers + " answers on this screen. A rough estimate from token counts; the Anthropic console has the real number."
        : "Nothing yet this month on this screen.";

    renderDiagnostics();
  }

  function renderDiagnostics() {
    var rows = [
      ["Viewport", window.innerWidth + " x " + window.innerHeight + " at " + (window.devicePixelRatio || 1) + "x"],
      ["Display", window.screen.width + " x " + window.screen.height],
      ["Streaming", typeof ReadableStream !== "undefined" && typeof TextDecoder !== "undefined" ? "Yes" : "No, answers arrive all at once"],
      ["Microphone access", navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? "Offered by this browser" : "Not available"],
      ["Dictation", speechSupported() ? "Offered by this browser" : "Not available"],
      ["Claude", state.session.claude ? "Connected" : "ANTHROPIC_API_KEY is not set"],
      ["Tessie", state.session.fleet ? "Connected" : "Not set up"],
      ["Browser", navigator.userAgent],
    ];
    var list = $("diag");
    list.textContent = "";
    rows.forEach(function (row) {
      list.appendChild(make("dt", "", row[0]));
      list.appendChild(make("dd", "", row[1]));
    });
  }

  function openSettings() {
    renderSettings();
    $("settings").hidden = false;
  }

  function closeSheets() {
    $("settings").hidden = true;
    $("tile-editor").hidden = true;
  }

  // Destructive buttons ask for a second tap instead of opening a native
  // confirm dialog, which the car's browser may not show.
  function confirmTap(button, action) {
    var original = button.textContent;
    var armed = false;
    var timer = 0;
    button.addEventListener("click", function () {
      if (armed) {
        clearTimeout(timer);
        armed = false;
        button.textContent = original;
        button.className = button.className.replace(" is-confirm", "");
        action();
        return;
      }
      armed = true;
      button.textContent = "Tap again to confirm";
      button.className += " is-confirm";
      timer = setTimeout(function () {
        armed = false;
        button.textContent = original;
        button.className = button.className.replace(" is-confirm", "");
      }, 3500);
    });
  }

  // ---------- Tile editor ----------

  function saveTiles() {
    save(KEYS.tiles, state.tiles);
    renderTiles();
    renderSettings();
  }

  function openTileEditor(index) {
    state.editingTile = index;
    var tile = index >= 0 ? state.tiles[index] : { label: "", prompt: "" };
    $("tile-editor-title").textContent = index >= 0 ? "Edit tile" : "New tile";
    $("tile-label").value = tile.label;
    $("tile-prompt").value = tile.prompt;
    $("tile-delete").hidden = index < 0;
    $("tile-editor").hidden = false;
  }

  function submitTile(event) {
    event.preventDefault();
    var label = $("tile-label").value.trim();
    var prompt = $("tile-prompt").value.trim();
    if (!label || !prompt) return;
    var tiles = state.tiles.slice();
    if (state.editingTile >= 0) tiles[state.editingTile] = { label: label, prompt: prompt };
    else tiles.push({ label: label, prompt: prompt });
    state.tiles = tiles;
    $("tile-editor").hidden = true;
    saveTiles();
  }

  // ---------- Dictation (phones and desktops; the car's Atom has no mic) ----------

  var recognition = null;

  function speechSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && !load(KEYS.voiceOff, false);
  }

  function toggleDictation() {
    var mic = $("mic");
    if (recognition) {
      recognition.stop();
      return;
    }
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.onresult = function (event) {
      var heard = "";
      for (var i = 0; i < event.results.length; i += 1) heard += event.results[i][0].transcript;
      var input = $("input");
      input.value = (input.value ? input.value + " " : "") + heard.trim();
      growInput();
    };
    recognition.onerror = function (event) {
      // Chromium builds without a speech service expose the API but can't use it.
      if (event.error === "service-not-allowed" || event.error === "network" || event.error === "language-not-supported") {
        save(KEYS.voiceOff, true);
        mic.hidden = true;
        setStatus("Dictation isn't available in this browser.");
        setTimeout(function () { if (!state.busy) setStatus(""); }, 4000);
      }
    };
    recognition.onend = function () {
      recognition = null;
      mic.className = "round-btn";
    };
    mic.className = "round-btn is-listening";
    try {
      recognition.start();
    } catch (e) {
      recognition = null;
      mic.className = "round-btn";
    }
  }

  // ---------- Composer ----------

  function growInput() {
    var input = $("input");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight + 2, 200) + "px";
  }

  function submitComposer(event) {
    event.preventDefault();
    if (state.busy) {
      stopAnswer();
      return;
    }
    var input = $("input");
    var text = input.value;
    if (!text.trim()) return;
    input.value = "";
    growInput();
    ask(text, {});
  }

  // ---------- Wiring ----------

  function bind() {
    $("keypad").addEventListener("click", function (event) {
      var target = event.target;
      while (target && target !== this && !target.getAttribute("data-key")) target = target.parentNode;
      if (target && target !== this && !target.disabled) pressKey(target.getAttribute("data-key"));
    });

    document.addEventListener("keydown", function (event) {
      if (!$("lock").hidden) {
        if (/^\d$/.test(event.key)) pressKey(event.key);
        else if (event.key === "Backspace") pressKey("back");
        else if (event.key === "Enter") pressKey("go");
        return;
      }
      if (event.key === "Escape") closeSheets();
    });

    $("nav-home").addEventListener("click", function () { showScreen("home"); });
    $("nav-chat").addEventListener("click", function () { showScreen("chat"); });
    $("nav-new").addEventListener("click", function () {
      newChat();
      showScreen("chat");
    });
    $("nav-settings").addEventListener("click", openSettings);
    $("mode-chip").addEventListener("click", openSettings);
    $("fleet-refresh").addEventListener("click", loadFleet);

    $("composer").addEventListener("submit", submitComposer);
    $("input").addEventListener("input", growInput);
    $("input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) submitComposer(event);
    });
    $("mic").addEventListener("click", toggleDictation);
    $("mic").hidden = !speechSupported();

    var closers = document.querySelectorAll("[data-close]");
    for (var i = 0; i < closers.length; i += 1) {
      closers[i].addEventListener("click", function () {
        if (!$("tile-editor").hidden) $("tile-editor").hidden = true;
        else closeSheets();
      });
    }

    $("tile-add").addEventListener("click", function () { openTileEditor(-1); });
    $("tile-form").addEventListener("submit", submitTile);
    confirmTap($("tile-delete"), function () {
      state.tiles = state.tiles.filter(function (tile, index) { return index !== state.editingTile; });
      $("tile-editor").hidden = true;
      saveTiles();
    });
    confirmTap($("tile-reset"), function () {
      drop(KEYS.tiles);
      state.tiles = state.session.tiles || DEFAULT_TILES;
      renderTiles();
      renderSettings();
    });
    confirmTap($("clear-chat"), function () {
      newChat();
      closeSheets();
    });
    confirmTap($("lock-now"), lockNow);

    if (window.matchMedia) {
      var scheme = window.matchMedia("(prefers-color-scheme: light)");
      if (scheme.addEventListener) scheme.addEventListener("change", applyAppearance);
      else if (scheme.addListener) scheme.addListener(applyAppearance);
    }

    setInterval(tickClock, 20000);
    setInterval(function () {
      if (state.session && state.session.fleet && state.screen === "home" && $("lock").hidden && document.visibilityState !== "hidden") loadFleet();
    }, FLEET_REFRESH_MS);
  }

  applyAppearance();
  tickClock();
  bind();
  if (state.pass) {
    setLockMessage("Unlocking", false);
    unlock(state.pass, true);
  } else {
    showLock();
  }
})();
