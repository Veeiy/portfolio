// Small response and request helpers shared by the API functions.

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function methodNotAllowed(allow) {
  return json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

// Reads a JSON body with a hard size cap, so a stray or hostile client can't
// make the function buffer megabytes before the request is rejected.
export async function readJson(request, maxBytes = 200_000) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new BodyError("Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new BodyError("Request body is too large.");
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BodyError("Request body must be a JSON object.");
    }
    return parsed;
  } catch (err) {
    if (err instanceof BodyError) throw err;
    throw new BodyError("Request body is not valid JSON.");
  }
}

export class BodyError extends Error {}

// A streamed newline-delimited JSON response. `produce` receives a `send`
// function and resolves when the stream is finished. `onCancel` runs when the
// client goes away (for example the driver taps Stop), so upstream work can be
// aborted instead of running, and billing, to completion.
export function ndjsonStream(produce, onCancel) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await produce(send);
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The client already disconnected.
          }
        }
      }
    },
    cancel() {
      closed = true;
      if (onCancel) onCancel();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Stops proxies from buffering the stream into one late chunk.
      "X-Accel-Buffering": "no",
    },
  });
}
