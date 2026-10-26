# Video Breakdown

Paste a TikTok, Instagram Reel, or YouTube Short. A model watches the video, frames and audio, and tells you:

- **The hook.** What happens in the first 3 seconds and why it stops the scroll.
- **Beat by beat.** A timestamped list of what's on screen.
- **Why it works.** Specific reasons tied to what was actually shown.
- **Remake it.** One concrete way to remake the format for *your* niche.
- **What's said and shown.** The spoken words and on-screen text.

I built it because I kept saving videos "for inspiration" and never figuring out what made them work.

## How it works

1. **yt-dlp** pulls the post's stats and a small MP4 into a temp folder.
2. The MP4 goes to **Gemini's Files API**.
3. A Flash-Lite model watches it and returns structured JSON against a fixed schema.
4. The temp file and Google's copy are deleted. Scans are saved to a local history file.

The prompt tells the model to describe only what it can see and hear. If one model is busy or retired, it falls back to the next.

## Why it runs locally

TikTok and Instagram block downloads from datacenter IPs, and serverless hosts don't ship the yt-dlp binary. So this is a local tool by design. Run it on your own machine and open it from your phone over Wi-Fi.

## Run it

You need Node 20+, [yt-dlp](https://github.com/yt-dlp/yt-dlp), and a free Gemini API key from [Google AI Studio](https://aistudio.google.com).

```bash
# yt-dlp, standalone binary (macOS)
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp

npm install
cp .env.example .env.local   # then paste your key in
npm run dev                  # http://localhost:3060
```

A scan takes about 1–2 minutes. Most of that is the model watching the video.

## Stack

Next.js 16 (App Router) · TypeScript · Gemini API with structured output · yt-dlp. No database: history is a local JSON file.

| File | What it does |
|---|---|
| `lib/vidscan.ts` | Download, upload, model call with fallback, history |
| `app/api/scan/route.ts` | Scan, list, and delete endpoints with input checks |
| `app/page.tsx` | The page |

## Limits

- **Public videos only.** Private, age-restricted, or region-locked posts fail with a plain error.
- **Instagram sometimes needs a login.** When it blocks the download, that's the error you'll see.
- **The model can be wrong.** It's told to stick to what's observable, but check the beat list against the video.
- **Remake ideas are a starting point.** Make original content. Don't reuse footage or imitate real people.

Built with Claude Code as a pair programmer.
