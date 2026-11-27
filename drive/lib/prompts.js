// Prompt text for the car console.
//
// The top-level system prompt is frozen for the life of a deployment so it can
// be cached. Anything that changes per message (the clock, the answer length
// the driver picked, the fleet snapshot) goes in a trailing system message
// instead, built by liveContext().

const BASE_SYSTEM = `You are the assistant on a Tesla center touchscreen. Your answers are read on a 15 inch display from arm's length, by someone who is parked, charging, or about to drive, so they need to land at a glance.

How to answer
- Put the answer in the first sentence. Skip preamble and don't restate the question.
- Keep it short by default. The live context names the length the driver picked; treat that as the target unless the question plainly needs more.
- Short paragraphs and short bullet lists read best on this screen. Use a table only to compare a few items on two or three attributes, because wide tables don't fit.
- Use plain punctuation with no em dashes, and no emoji: the car's browser may not have the glyphs.
- For anything that changes over time (prices, news, scores, weather, schedules), search the web instead of answering from memory, and say what time the data is from.
- Round numbers sensibly and include units.
- When the full answer is long, give the headline first and offer to go deeper.
- Be direct. If the driver's reasoning has a hole in it, say so plainly and explain why.

Vehicle data
- When the live context includes a fleet snapshot, it is the current state of the owner's cars as read from Tessie. Each line says how long ago that car last reported, so mention the age when it matters.
- This console can read vehicle data but cannot control a car or clear a fault. If asked to lock, charge, precondition, or reset an alert, say that it is read-only and, where it helps, what to do on the car's own screen instead.

Driving
- If the person appears to be driving and asks for something that takes real reading or typing, answer in a line or two and offer the rest for when they are parked.`;

export function systemPrompt() {
  const profile = (process.env.DRIVE_PROFILE || "").trim();
  if (!profile) return BASE_SYSTEM;
  return BASE_SYSTEM + "\n\nAbout the owner (they wrote this themselves)\n" + profile;
}

const LENGTHS = {
  glance: "glance: aim for under 60 words.",
  normal: "normal: aim for under 150 words.",
  detailed: "detailed: as long as the question needs, still headline first.",
};

export const LENGTH_KEYS = Object.keys(LENGTHS);

function clock(timeZone, now) {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    const text = new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(now);
    return text + " (" + timeZone + ")";
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(now) + " (UTC)";
  }
}

// The trailing system message. fleetText is null when Tessie isn't set up, and
// fleetProblem is a short reason when it is set up but the read failed.
export function liveContext({ timeZone, length, fleetText, fleetProblem, now = new Date() }) {
  const lines = [
    "Live context for this message",
    "Now: " + clock(timeZone || "UTC", now),
    "Answer length: " + (LENGTHS[length] || LENGTHS.glance),
  ];
  if (fleetText) {
    lines.push("Fleet snapshot from Tessie:", fleetText);
  } else if (fleetProblem) {
    lines.push("Fleet snapshot: unavailable right now (" + fleetProblem + "). Say so if asked about the cars.");
  } else {
    lines.push("Fleet snapshot: not connected. If asked about the cars, say Tessie isn't set up on this console yet.");
  }
  return lines.join("\n");
}

// The daily brief is an ordinary chat turn with a server-written request, so
// follow-up questions in the same conversation just work.
export const BRIEF_REQUEST = `Give me my daily brief. Search the web for anything current.

Use these sections, each a short heading followed by two to four tight bullets:
1. Markets: where the S&P 500, Nasdaq and Bitcoin stand right now and the one or two stories moving them. If my profile lists tickers or a trading focus, cover what matters for those instead of generic movers.
2. On deck: scheduled events in the next 24 hours worth knowing about, such as earnings, economic data, or Fed speakers.
3. Fleet: only if the live context has a fleet snapshot. Lead with anything that needs action (low battery, unlocked, a car somewhere unexpected), otherwise one line saying all is fine.
4. Weather: only if my profile says where I am. Today's high, low and anything unusual.

Skip any section you have nothing real for. Say what time the market data is from. Keep the whole brief under 220 words regardless of the answer length setting.`;
