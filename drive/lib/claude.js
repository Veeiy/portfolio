// The one place that talks to the Claude API.
//
// A turn is a single streamed Messages request with the server-side web search
// tool. There are no client-run tools, so there is no tool loop to host: the
// only reason to send a second request is a paused search turn.

import Anthropic from "@anthropic-ai/sdk";

// Prices are USD per million tokens, used only for the rough spend estimate in
// Settings. Check anthropic.com/pricing before trusting them for anything else.
export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5", note: "Smartest", serverFallback: true, price: { input: 4, output: 20 } },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", note: "Balanced", serverFallback: true, price: { input: 2, output: 10 } },
  "claude-haiku-5-5": { label: "Haiku 5.5", note: "Fastest", serverFallback: false, price: { input: 0.1, output: 0.5 } },
};
export const DEFAULT_MODEL = "claude-opus-5-5";
export const SEARCH_PRICE = 0.01; // USD per web search

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_RESUMES = 3;
const MAX_SOURCES = 6;

let sharedClient;
function client() {
  if (!sharedClient) sharedClient = new Anthropic();
  return sharedClient;
}

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function addSource(sources, url, title) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  if (sources.length >= MAX_SOURCES || sources.some((s) => s.url === url)) return;
  sources.push({ url, title: typeof title === "string" && title ? title : url });
}

// Prefers pages the answer actually cited; falls back to the top search hits
// when the model searched but didn't attach citations.
function collectSources(content, sources) {
  for (const block of content) {
    if (block.type !== "text" || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations) {
      if (citation.type === "web_search_result_location") addSource(sources, citation.url, citation.title);
    }
  }
  if (sources.length) return;
  for (const block of content) {
    // On a failed search `content` is an error object, not a list.
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const result of block.content.slice(0, 3)) addSource(sources, result.url, result.title);
  }
}

// Yields plain events for the browser:
//   { t: "status", v: "thinking" | "searching" | "writing" }
//   { t: "delta", v: "<text>" }
//   { t: "refusal" } | { t: "truncated" }
//   { t: "done", model, usage: { input, output, searches }, sources: [{ url, title }] }
export async function* runTurn({ model, effort, system, messages, maxSearches, maxTokens, timeZone, signal }) {
  const spec = MODELS[model];
  const search = { type: "web_search_20260209", name: "web_search", max_uses: maxSearches };
  if (timeZone) search.user_location = { type: "approximate", timezone: timeZone };

  const params = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [search],
    // Thinking is adaptive on all three models when `thinking` is omitted;
    // effort is the control for how much of it happens.
    output_config: { effort },
  };
  // A safety classifier can decline a harmless request. With this opt-in the
  // API re-runs a declined request on another model inside the same call
  // rather than handing the driver a refusal. Haiku 5.5 has no server-side
  // fallback, so its refusals are surfaced as they are.
  if (spec.serverFallback) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }

  const conversation = messages.slice();
  const usage = { input: 0, output: 0, searches: 0 };
  const sources = [];
  let status = "";
  let last;

  for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
    const stream = client().beta.messages.stream({ ...params, messages: conversation }, { signal });

    for await (const event of stream) {
      let next = "";
      if (event.type === "content_block_start") {
        const kind = event.content_block.type;
        if (kind === "thinking" || kind === "redacted_thinking") next = "thinking";
        else if (kind === "server_tool_use") next = "searching";
        else if (kind === "text") next = "writing";
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { t: "delta", v: event.delta.text };
      }
      if (next && next !== status) {
        status = next;
        yield { t: "status", v: status };
      }
    }

    last = await stream.finalMessage();
    const u = last.usage || {};
    usage.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    usage.output += u.output_tokens || 0;
    usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    collectSources(last.content, sources);

    // A long search turn can pause. Sending the paused assistant message back
    // unchanged lets the server pick up where it stopped.
    if (last.stop_reason === "pause_turn" && attempt < MAX_RESUMES) {
      conversation.push({ role: "assistant", content: last.content });
      continue;
    }
    break;
  }

  if (last.stop_reason === "refusal") yield { t: "refusal" };
  else if (last.stop_reason === "max_tokens" || last.stop_reason === "pause_turn") yield { t: "truncated" };
  yield { t: "done", model: last.model, usage, sources };
}

// A short, driver-readable description of an API failure.
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key isn't allowed to use that model.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the API. Give it a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return "The API rejected the request: " + err.message;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Claude API. Check the connection and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    return "Claude had a problem (status " + err.status + "). Try again.";
  }
  return "Something went wrong on the server.";
}

export function isAbort(err) {
  return err instanceof Anthropic.APIUserAbortError || (err && err.name === "AbortError");
}
