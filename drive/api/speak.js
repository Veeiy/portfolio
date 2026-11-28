// POST /api/speak
// Turns a piece of answer text into audio and returns the audio bytes.

import { requireAuth } from "../lib/auth.js";
import { json, methodNotAllowed, readJson, BodyError } from "../lib/http.js";
import { speechToken, synthesize, SpeechError, VOICES, DEFAULT_VOICE, MAX_SPEECH_CHARS } from "../lib/speech.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const denied = await requireAuth(request);
    if (denied) return denied;

    const token = speechToken(request);
    if (!token) {
      return json(
        { error: "not_configured", message: "Speech needs Vercel AI Gateway, which isn't available on this deployment." },
        503,
      );
    }

    let body;
    try {
      body = await readJson(request, 20_000);
    } catch (err) {
      if (err instanceof BodyError) return json({ error: "bad_request", message: err.message }, 400);
      throw err;
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "bad_request", message: "text must be a non-empty string." }, 400);
    if (text.length > MAX_SPEECH_CHARS) return json({ error: "bad_request", message: "That is too long to read aloud." }, 400);
    const voice = VOICES.includes(body.voice) ? body.voice : DEFAULT_VOICE;

    try {
      const audio = await synthesize({ token, text, voice, signal: request.signal });
      // The service is asked for MP3; a WAV is labeled as such if one comes back.
      const type = audio.subarray(0, 4).toString("latin1") === "RIFF" ? "audio/wav" : "audio/mpeg";
      return new Response(audio, {
        status: 200,
        headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch (err) {
      if (err instanceof SpeechError) return json({ error: "speech_failed", message: err.message }, 502);
      if (err && err.name === "AbortError") return new Response(null, { status: 499 });
      throw err;
    }
  },
};
