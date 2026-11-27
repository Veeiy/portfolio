// Local dev server: serves public/ and runs the api/ functions the way Vercel
// does (a default export with a fetch(request) handler), with the headers from
// vercel.json applied so the Content-Security-Policy is tested locally too.
//
//   npm run dev         real services; reads keys from .env.local if present
//   npm run dev:mock    stubbed Claude and Tessie, passcode 123456, no cost

import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = process.argv.includes("--mock");
const port = Number(process.env.PORT || 3000);

const envFile = path.join(here, ".env.local");
if (!mock && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

if (mock) {
  const { startStubs } = await import("./tools/stub-services.mjs");
  const stubs = await startStubs(Number(process.env.STUB_PORT || 0));
  const base = "http://127.0.0.1:" + stubs.port;
  // MOCK_PROVIDER picks how the app reaches "Claude": anthropic (default),
  // gateway (an AI Gateway key), oidc (only the per-request Vercel token),
  // or none.
  const via = process.env.MOCK_PROVIDER || "anthropic";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.AI_GATEWAY_BASE_URL = base;
  if (via === "anthropic") process.env.ANTHROPIC_API_KEY = "stub-key";
  if (via === "gateway") process.env.AI_GATEWAY_API_KEY = "stub-gateway-key";
  process.env.TESSIE_BASE_URL = base;
  if (process.env.MOCK_FLEET !== "off") process.env.TESSIE_TOKEN = "stub-token";
  process.env.DRIVE_PASSCODE = process.env.DRIVE_PASSCODE || "123456";
  console.log("stubs on " + base + "  (passcode " + process.env.DRIVE_PASSCODE + ")");
}

const config = JSON.parse(await readFile(path.join(here, "vercel.json"), "utf8"));
const siteHeaders = Object.fromEntries(
  (config.headers || []).flatMap((rule) => rule.headers.map((h) => [h.key, h.value])),
);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function runFunction(name, req, res) {
  const file = path.join(here, "api", name + ".js");
  if (!/^[a-z-]+$/.test(name) || !existsSync(file)) return false;
  const handler = (await import(pathToFileURL(file).href)).default;

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const init = { method: req.method, headers: req.headers, signal: abort.signal };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  const response = await handler.fetch(new Request("http://" + req.headers.host + req.url, init));

  res.writeHead(response.status, { ...siteHeaders, ...Object.fromEntries(response.headers) });
  if (!response.body) return res.end(), true;
  const reader = response.body.getReader();
  res.on("close", () => reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
  return true;
}

async function serveStatic(pathname, res) {
  const clean = pathname === "/" ? "/index.html" : pathname;
  const candidates = [clean, clean + ".html"];
  for (const candidate of candidates) {
    const file = path.join(here, "public", path.normalize(candidate));
    if (!file.startsWith(path.join(here, "public") + path.sep)) continue;
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...siteHeaders, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://local");
    if (pathname.startsWith("/api/")) {
      if (await runFunction(pathname.slice(5), req, res)) return;
    } else if (await serveStatic(pathname, res)) {
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(port, () => console.log("drive console on http://localhost:" + port));
