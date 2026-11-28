// Text to speech through Vercel AI Gateway.
//
// The Claude API has no speech endpoint, so spoken answers always go through
// the gateway, whichever way the text itself was generated. That means speech
// is only available where a gateway credential exists: on Vercel (the
// per-request OIDC token) or with AI_GATEWAY_API_KEY.

import { gatewayToken, GATEWAY_URL } from "./claude.js";

export const SPEECH_MODEL = "openai/tts-1";
export const SPEECH_PRICE = 0.000015; // USD per character, for the spend estimate
export const VOICES = ["alloy", "echo", "nova", "onyx"];
export const DEFAULT_VOICE = "alloy";
export const MAX_SPEECH_CHARS = 3000;

export class SpeechError extends Error {}

export function speechToken(request) {
  return gatewayToken(request);
}

// Returns the audio as a Buffer (MP3).
export async function synthesize({ token, text, voice, signal }) {
  let response;
  try {
    response = await fetch(GATEWAY_URL + "/v4/ai/speech-model", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-speech-model-specification-version": "4",
        "ai-model-id": SPEECH_MODEL,
      },
      body: JSON.stringify({ text, voice, outputFormat: "mp3" }),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new SpeechError("Couldn't reach the speech service.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = (body && body.error && body.error.message) || "";
    } catch {
      // No readable error body.
    }
    const short = detail.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new SpeechError("The speech service refused the request (" + response.status + ")" + (short ? ": " + short : "."));
  }
  const data = await response.json();
  if (!data || typeof data.audio !== "string" || !data.audio) {
    throw new SpeechError("The speech service returned no audio.");
  }
  return Buffer.from(data.audio, "base64");
}
