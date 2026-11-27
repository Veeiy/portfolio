// POST /api/chat
// Streams one assistant turn back as newline-delimited JSON events.
//
// The browser keeps the conversation and sends it with each request, so this
// function holds no state between calls.

import { requireAuth } from "../lib/auth.js";
import { json, methodNotAllowed, readJson, BodyError, ndjsonStream } from "../lib/http.js";
import { MODELS, DEFAULT_MODEL, claudeConfigured, runTurn, describeError, isAbort } from "../lib/claude.js";
import { systemPrompt, liveContext, BRIEF_REQUEST, LENGTH_KEYS } from "../lib/prompts.js";
import { getFleet, describeFleet } from "../lib/tessie.js";

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 120_000;

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

function parse(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { problem: "messages must be a non-empty array." };
  }
  if (body.messages.length > MAX_MESSAGES) {
    return { problem: "Too many messages. Start a new chat." };
  }
  const messages = [];
  let total = 0;
  for (const m of body.messages) {
    const role = m && m.role;
    const content = m && m.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return { problem: "Each message needs a role of user or assistant and non-empty text." };
    }
    if (content.length > MAX_MESSAGE_CHARS) return { problem: "A message is too long." };
    total += content.length;
    messages.push({ role, content });
  }
  if (total > MAX_TOTAL_CHARS) return { problem: "The conversation is too long. Start a new chat." };
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") {
    return { problem: "The conversation must start and end with a user message." };
  }
  return {
    messages,
    model: typeof body.model === "string" && Object.hasOwn(MODELS, body.model) ? body.model : DEFAULT_MODEL,
    deep: body.depth === "deep",
    length: LENGTH_KEYS.includes(body.length) ? body.length : "glance",
    brief: body.kind === "brief",
    timeZone: validTimeZone(body.timeZone),
  };
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const denied = await requireAuth(request);
    if (denied) return denied;
    if (!claudeConfigured()) {
      return json(
        { error: "not_configured", message: "Set ANTHROPIC_API_KEY in the server environment, then redeploy." },
        503,
      );
    }

    let input;
    try {
      input = parse(await readJson(request));
    } catch (err) {
      if (err instanceof BodyError) return json({ error: "bad_request", message: err.message }, 400);
      throw err;
    }
    if (input.problem) return json({ error: "bad_request", message: input.problem }, 400);

    // A Tessie outage shouldn't take chat down with it; the model is told the
    // snapshot is missing and why.
    let fleetText = null;
    let fleetProblem = null;
    try {
      const fleet = await getFleet();
      if (fleet) fleetText = describeFleet(fleet);
    } catch (err) {
      fleetProblem = err && err.message ? err.message : "Tessie is unavailable";
    }

    const messages = input.messages.slice();
    if (input.brief) messages[messages.length - 1] = { role: "user", content: BRIEF_REQUEST };
    messages.push({
      role: "system",
      content: liveContext({
        timeZone: input.timeZone,
        length: input.length,
        fleetText,
        fleetProblem,
      }),
    });

    const abort = new AbortController();
    if (request.signal) {
      if (request.signal.aborted) abort.abort();
      else request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    }

    return ndjsonStream(
      async (send) => {
        try {
          const turn = runTurn({
            model: input.model,
            effort: input.brief ? "medium" : input.deep ? "high" : "low",
            system: systemPrompt(),
            messages,
            maxSearches: input.brief || input.deep ? 6 : 3,
            maxTokens: input.deep ? 32_000 : 16_000,
            timeZone: input.timeZone,
            signal: abort.signal,
          });
          for await (const event of turn) send(event);
        } catch (err) {
          if (isAbort(err)) return;
          console.error("chat turn failed:", err);
          send({ t: "error", v: describeError(err) });
        }
      },
      () => abort.abort(),
    );
  },
};
