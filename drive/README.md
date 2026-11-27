# Drive

A Claude console sized for a Tesla center screen. It runs in the car's built-in browser, so there is nothing to install on the car: you open a URL and bookmark it.

It is its own small app. It lives in this folder, deploys as its own Vercel project, and shares nothing with the rest of the repo.

## What it does

- **Big-touch chat.** Large type, short answers by default, one-tap follow-ups (Shorter, Go deeper, Why?), and a Stop button that also cancels the API call.
- **Prompt tiles.** One tap asks a saved question. Add, edit and delete them in Settings.
- **Daily brief.** Markets, what's on deck, and your fleet. Tap once, then ask follow-ups in the same chat.
- **Fleet card.** Battery, range, charging, location and lock state for every Tesla on your Tessie account. Claude sees the same snapshot and can answer questions about it.
- **Your settings.** Model (Opus 5.5, Sonnet 5.5, Haiku 5.5), quick or deep thinking, answer length, text size, theme, accent color, and whether the typing box sits at the top or bottom.
- **Live web search** on every model, with the sources shown under the answer.

## What it can't do

- **Control the car or clear faults.** It reads data. It never sends a command, and no outside app can clear a Tesla alert.
- **Use the car's microphone.** A 2021 Model 3 has the Intel Atom infotainment computer, and Tesla's browser only offers mic access on AMD Ryzen cars. You type, or tap a tile. On a phone or laptop the mic button appears and dictation works.
- **Share anything with the Claude app.** This talks to Claude's API. Your Claude subscription, memory, projects and connectors are separate.

## Set it up

Claude can be reached two ways, and you only need one:

- **Vercel AI Gateway (no key).** On Vercel the app authenticates to the gateway with the project's own short-lived token. Nothing to create or store. Usage is billed to the Vercel team at the model's list price.
- **Your own Anthropic API key.** Set `ANTHROPIC_API_KEY` and the app calls the Claude API directly and bills your Anthropic account. When this is set it always wins.

Tessie is optional either way.

1. **Create the Vercel project.** In Vercel, add a new project from this repo, set **Root Directory** to `drive`, and leave the framework preset on Other. No build command is needed.
2. **Add environment variables** in the project's settings:

   | Variable | Required | What it is |
   |---|---|---|
   | `DRIVE_PASSCODE` | Yes | 6 to 12 digits. This is the PIN you type on the car screen. Use 8 or more. |
   | `ANTHROPIC_API_KEY` | No | From console.anthropic.com. Leave it unset to use Vercel AI Gateway. |
   | `TESSIE_TOKEN` | No | From dash.tessie.com/settings/api. Turns on the fleet card. |
   | `DRIVE_PROFILE` | No | A few sentences about you: where you are, what you trade, how you like answers. Claude reads it on every message. |
   | `DRIVE_TILES` | No | Preloads home tiles so you don't type them on the car keyboard. JSON: `[{"label":"Market pulse","prompt":"..."}]` |

3. **Deploy**, then open the production URL in the car's browser, enter the passcode, and bookmark the page.

Use the production URL in the car. Vercel puts a login wall in front of preview deployments by default.

Environment variable changes only take effect after a redeploy.

## What it costs

You pay per use, to Vercel through AI Gateway or to Anthropic with your own key. The rates are the same. Rough numbers for a typical car question (about 4,000 tokens in, 400 out):

| Model | Per question |
|---|---|
| Haiku 5.5 | under a tenth of a cent |
| Sonnet 5.5 | about 1 cent |
| Opus 5.5 | about 2.5 cents |

Each web search adds 1 cent. A daily brief runs up to six searches. Settings shows a running estimate for the month; the Vercel or Anthropic dashboard has the real figure. Set a spend limit there.

## Run it locally

```bash
npm install
npm run dev:mock   # stubbed Claude and Tessie, passcode 123456, costs nothing
npm run dev        # real services; put your keys in .env.local (see .env.example)
npm test           # 52 checks against the stubs
```

`npm test` runs the API checks with no extra setup. The browser checks need Playwright (`npm i -D playwright`) and are skipped without it.

## How it's put together

```
public/   the page: index.html, app.css, app.js (no framework, no build step)
api/      three Vercel functions: session, fleet, chat
lib/      auth, the Claude call, the Tessie client, the prompts
tools/    local stubs and the smoke test
```

- **One streamed request per answer.** `lib/claude.js` calls the Messages API with the server-side web search tool, either directly or through AI Gateway, which speaks the same API. There are no client-run tools, so there is no agent loop to host.
- **Stateless server.** The browser keeps the conversation and sends it with each message. Settings, tiles and chat history live in that browser's storage, so the car and your phone each keep their own.
- **Live context.** The clock, your chosen answer length and the fleet snapshot ride in their own system block after the main prompt, so the main prompt stays cacheable.
- **Built for a slow browser.** Plain HTML, CSS and JavaScript with nothing newer than async/await, no blur or heavy animation, and streamed text repainted a few times a second.

## Security notes

- Every API route needs the passcode. If `DRIVE_PASSCODE` is missing or malformed the routes refuse to run.
- Eight wrong passcodes from one address lock that address out for ten minutes. That counter lives in one function instance's memory, so treat it as a speed bump. The passcode length is the real protection, and a spend limit caps the damage if it ever leaks.
- The browser never receives VINs or raw coordinates. It does get street addresses for the fleet card.
- Model output is escaped before it is rendered, links are limited to http and https, and a strict Content-Security-Policy blocks inline script.

## Not verified yet

- **The live Claude API and live Tessie.** Everything was tested against local stubs that speak the same wire formats, through the real Anthropic SDK. No real key was available where this was built.
- **The car itself.** The layout was checked in desktop Chromium at car-like sizes. Settings has a "This screen" panel that reports the car browser's real viewport and capabilities, which is the first thing to look at if something is off.
- **Tessie's units.** Their docs don't state them. The code assumes Tesla's native miles, Celsius and bar, then converts to what your car displays. If a number looks wrong on the fleet card, that assumption is the place to look (`lib/tessie.js`).

## Next steps worth considering

- **Phone as remote.** Talk or type on your phone and have the answer appear on the car screen. This needs a small realtime store, which would also sync tiles and settings between devices.
- **Calendar in the brief.** Needs a Google sign-in flow.
