// GET /api/session
// Checks the passcode and tells the browser what this deployment can do.

import { requireAuth } from "../lib/auth.js";
import { json, methodNotAllowed } from "../lib/http.js";
import { MODELS, DEFAULT_MODEL, SEARCH_PRICE, resolveProvider } from "../lib/claude.js";
import { fleetConfigured } from "../lib/tessie.js";
import { speechToken, SPEECH_PRICE, VOICES, DEFAULT_VOICE } from "../lib/speech.js";

const MAX_TILES = 12;

// DRIVE_TILES lets the owner preload home-screen tiles without typing them on
// the car's keyboard: a JSON array of { "label": "...", "prompt": "..." }.
function envTiles() {
  const raw = process.env.DRIVE_TILES;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const tiles = parsed
      .filter((t) => t && typeof t.label === "string" && typeof t.prompt === "string")
      .map((t) => ({ label: t.label.trim().slice(0, 40), prompt: t.prompt.trim().slice(0, 2000) }))
      .filter((t) => t.label && t.prompt)
      .slice(0, MAX_TILES);
    return tiles.length ? tiles : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const denied = await requireAuth(request);
    if (denied) return denied;

    const provider = resolveProvider(request);
    return json({
      ok: true,
      claude: Boolean(provider),
      provider: provider ? provider.kind : null,
      fleet: fleetConfigured(),
      speech: Boolean(speechToken(request)),
      speechPrice: SPEECH_PRICE,
      voices: VOICES,
      defaultVoice: DEFAULT_VOICE,
      defaultModel: DEFAULT_MODEL,
      searchPrice: SEARCH_PRICE,
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, note: m.note, price: m.price })),
      tiles: envTiles(),
    });
  },
};
