# Static site verification

This site serves checked-in HTML. It has no framework build step. Run from the repository root with Node and Playwright available:

```bash
NODE_PATH=~/bradohaire-portfolio/node_modules node tools/audit.mjs
```

The audit discovers HTML recursively outside tool/config directories, serves clean URLs locally, and checks every page at 1440 x 900 and 390 x 844. It fails for broken local references or fragments, publishing-fence patterns, new-page metadata mismatches, console/page errors, failed HTTP responses, unrevealed sections, missing shared styles, horizontal page overflow, and Work index group counts that do not match their cards. On new pages it also exercises the All work link, keyboard skip link, and focusable horizontal table regions. It scrolls the page to trigger existing reveals before screenshots and does not force hidden content visible.

Proof goes to ignored `tools/audit-out/`: `report.json`, full-page screenshots for every viewport, top-of-page screenshots for the new articles, and separate table crops. The sticky page header is hidden only during table component crops so it cannot obscure a row; full-page and top screenshots retain the real header. A clean exit is required, followed by visual inspection against `work/production-systems.html`, with special attention to the tables on mobile. The new-page metadata checks compare page titles to the OG generator's source; visually verify that freshly rendered PNGs match too.

For a quick filesystem-only check:

```bash
node tools/audit.mjs --static-only
```

This explicitly reports that browser behavior is unverified. It is not a substitute for the complete audit. The pattern scan cannot establish semantic privacy, source truth, or numerical fidelity; review the final prose and figures against their approved source separately. Tool source and PNG text need their own review.

Regenerate the three approved OG cards (architecture, CS1, and CS2) after updating their approved titles and subtitles:

```bash
NODE_PATH=~/bradohaire-portfolio/node_modules node tools/og-cards.mjs
```

Pass a slug to regenerate one card. The final CS1 card states its N=2 sample and post hoc Codex assessment of saved Claude responses; regenerate it from this source instead of using the provisional image from the earlier handover. Both scripts resolve Playwright through Node's standard module lookup or `NODE_PATH`. If the existing installation is unavailable, a local tools-only install is sufficient: `npm install playwright --prefix tools`, then `npx --prefix tools playwright install chromium` if the browser is missing. Do not add dependencies, screenshots, local configuration, or evidence files to a publication commit.

The audit starts a local HTTP listener and Chromium; a restricted execution environment may require permission for those operations. It does not deploy, publish, or change a repository's Git state.
