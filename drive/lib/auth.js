// Passcode gate for every API route.
//
// The console is a single-owner tool: one numeric passcode, set as the
// DRIVE_PASSCODE environment variable and typed once on the car's PIN pad.
// Digits only so it can be entered on big touch keys.

import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "./http.js";

const PASSCODE_SHAPE = /^\d{6,12}$/;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;
const FAILURE_DELAY_MS = 400;

// Wrong-passcode counts per client address. This lives in one function
// instance's memory, so it slows guessing rather than stopping it outright;
// the passcode length is what actually carries the security.
const failures = new Map();

function clientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function sameSecret(a, b) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns null when the request is allowed, otherwise the Response to send.
export async function requireAuth(request) {
  const expected = process.env.DRIVE_PASSCODE || "";
  if (!PASSCODE_SHAPE.test(expected)) {
    return json(
      {
        error: "not_configured",
        message: "Set DRIVE_PASSCODE to a 6 to 12 digit number in the server environment, then redeploy.",
      },
      503,
    );
  }

  const address = clientAddress(request);
  const now = Date.now();
  let record = failures.get(address);
  if (record && now - record.first > WINDOW_MS) {
    failures.delete(address);
    record = undefined;
  }
  if (record && record.count >= MAX_FAILURES) {
    return json(
      { error: "locked_out", message: "Too many wrong passcodes. Try again in a few minutes." },
      429,
    );
  }

  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given && sameSecret(given, expected)) {
    failures.delete(address);
    return null;
  }

  if (given) {
    if (record) record.count += 1;
    else failures.set(address, { count: 1, first: now });
    await sleep(FAILURE_DELAY_MS);
  }
  return json({ error: "unauthorized", message: "Wrong passcode." }, 401);
}
