---
name: yt-analyze
description: Pull a YouTube video's transcript and metadata, then give a critical analysis. Use when the user pastes a YouTube link (youtube.com, youtu.be, shorts) and asks for thoughts, a summary, a breakdown, "is this legit", or "analyze this video". Use this instead of web fetch, which cannot read YouTube.
---

# yt-analyze

Turn a YouTube link into a transcript, then into an honest take.

## 1. Grab the video

Use yt-dlp through the bundled script. Do not hunt for transcript APIs,
third-party sites or browser automation; this path is known to work.

```bash
pip install -q yt-dlp 2>/dev/null || true
SKILL_DIR="$(dirname "$(find / -path '*skills/yt-analyze/SKILL.md' 2>/dev/null | head -1)")"
python3 "$SKILL_DIR/scripts/ytgrab.py" "<url>" "<scratch-or-temp-dir>"
```

Output lands in `<dir>/<video_id>/`:
- `meta.json`: title, channel, upload date, views, duration, description, chapters
- `transcript.txt`: captions merged into ~30s timestamped paragraphs

Read both files fully before writing anything.

### If it fails
- **Host blocked / DNS error** (cloud sessions): the environment needs
  `www.youtube.com`, `youtu.be`, `i.ytimg.com` allowed. Propose that network
  change; don't work around it.
- **"Sign in to confirm you're not a bot"**: normal from cloud IPs. The script
  already rotates to the `web_embedded` client, which usually gets through.
- **HTTP 429 on captions**: rate limit. Rerun the script once; it typically
  succeeds on the second try.
- **No captions at all**: report title and channel from `meta.json` and ask
  the user to paste the transcript. Never analyze a video you have not read.

## 2. Analyze

Follow the tone and formatting preferences in the user's CLAUDE.md. Keep it
structured and fast to scan. Be a sparring partner, not a fan.

1. **Header**: title, channel, date, views, length, and what is being sold
   (course, community, affiliate, sponsor). Check the description for this.
2. **What's actually good**: the 3 to 5 ideas worth keeping, each in one or
   two lines, with the timestamp.
3. **Where I'd push back**: rigged demos, made-up numbers, survivorship
   stories, claims the creator contradicts elsewhere, and advice that is
   risky in practice (for example, unattended autonomy over money, accounts
   or outbound messages).
4. **How it applies to you**: compare against the user's existing setup
   (their skills, CLAUDE.md and current projects). Name the single
   highest-value action, and say plainly if the answer is "nothing new here."
5. Offer one concrete next step.

Cite timestamps like `[05:42]` so claims can be checked against the video.
