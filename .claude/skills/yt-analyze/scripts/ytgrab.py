#!/usr/bin/env python3
"""ytgrab: pull a YouTube video's metadata + transcript for analysis.

Usage: python3 ytgrab.py <youtube-url> [out_dir]

Writes to out_dir/<video_id>/:
  meta.json        title, channel, date, views, duration, description, chapters
  transcript.txt   transcript merged into ~30s timestamped paragraphs

Works from cloud/datacenter IPs: YouTube bot-walls most yt-dlp clients there,
but the `web_embedded` client still returns captions + metadata. Falls back to
oEmbed (title/channel only) if everything else fails. Needs: pip install yt-dlp
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

import yt_dlp

CLIENTS = ["web_embedded", "default", "tv"]


def video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})", url)
    if not m:
        sys.exit(f"Could not find a video ID in: {url}")
    return m.group(1)


def vtt_to_text(path: Path, chunk_s: int = 30) -> str:
    def sec(ts):
        h, m, s = map(int, ts.split(":"))
        return h * 3600 + m * 60 + s

    rows, last, ts = [], None, None
    for line in path.read_text().splitlines():
        m = re.match(r"(\d+:\d+:\d+)\.\d+ -->", line)
        if m:
            ts = m.group(1)
            continue
        t = re.sub(r"<[^>]+>", "", line).strip()
        if not t or t.startswith(("WEBVTT", "Kind:", "Language:")) or t == last:
            continue
        last = t
        rows.append((ts, t))

    out, buf, start = [], [], None
    for ts, t in rows:
        start = start or ts
        buf.append(t)
        if sec(ts) - sec(start) >= chunk_s:
            out.append(f"[{start}] " + " ".join(buf))
            buf, start = [], None
    if buf:
        out.append(f"[{start}] " + " ".join(buf))
    return "\n\n".join(out)


def try_client(vid: str, out: Path, client: str) -> dict | None:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignore_no_formats_error": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en-orig", "en"],
        "subtitlesformat": "vtt",
        "outtmpl": str(out / "subs"),
    }
    if client != "default":
        opts["extractor_args"] = {"youtube": {"player_client": [client]}}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
    except Exception as e:
        print(f"[miss] client={client}: {str(e).splitlines()[0][:120]}")
        return None


def oembed(vid: str) -> dict:
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
    with urllib.request.urlopen(url, timeout=15) as r:
        d = json.load(r)
    return {"id": vid, "title": d.get("title"), "channel": d.get("author_name")}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    vid = video_id(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".") / vid
    out.mkdir(parents=True, exist_ok=True)

    info = None
    for c in CLIENTS:
        info = try_client(vid, out, c)
        if info and list(out.glob("subs*.vtt")):
            print(f"[ok] client={c}")
            break

    keep = ["id", "title", "channel", "upload_date", "view_count", "like_count",
            "duration", "description", "chapters", "tags"]
    meta = {k: info.get(k) for k in keep} if info else {}
    if not meta.get("title"):
        try:
            meta = oembed(vid)
        except Exception as e:
            print(f"[fail] oembed: {e}")
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"[ok] meta: {meta.get('title')} | {meta.get('channel')}")

    vtts = sorted(out.glob("subs*.vtt"), key=lambda p: "en-orig" not in p.name)
    if vtts:
        (out / "transcript.txt").write_text(vtt_to_text(vtts[0]))
        print(f"[ok] transcript from {vtts[0].name}")
    else:
        print("[fail] no captions (rate-limited or none exist). Retry in a minute.")

    print(f"Output: {out.resolve()}")


if __name__ == "__main__":
    main()
