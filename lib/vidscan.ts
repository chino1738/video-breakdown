// Video scanner: paste a public TikTok / Instagram / YouTube link → stats + an AI
// breakdown of what the video actually shows.
//
// How: yt-dlp pulls the metadata and a small mp4 into a temp folder, the mp4 goes
// to Gemini's Files API, and a Flash-Lite model "watches" it (frames + audio) and
// returns structured JSON. The temp file is always deleted.
//
// Runs on your own machine. TikTok and Instagram block downloads from datacenter IPs,
// and serverless hosts have no yt-dlp binary, so this is a local tool by design.
// History lives in data/scans.json (gitignored).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

export type ScanBreakdown = {
  summary: string;
  hook: string;
  timeline: { at: string; shows: string }[];
  spoken: string;
  on_screen_text: string;
  why_it_works: string[];
  remake_idea: string;
  niche: string | null; // the niche the remake idea was written for
};

export type Scan = {
  id: string;
  url: string;
  platform: string;
  creator: string | null;
  caption: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  postedAt: string | null; // YYYY-MM-DD
  sound: string | null;
  stats: { views: number | null; likes: number | null; comments: number | null; shares: number | null };
  breakdown: ScanBreakdown | null;
  model: string | null;
  error: string | null; // set when stats came through but the AI step failed
  scannedAt: string;
};

const SCANS_FILE = path.join(process.cwd(), "data", "scans.json");
const MAX_HISTORY = 50;
const MAX_BYTES = 120 * 1024 * 1024; // Files API takes far more; this just stops a runaway download

// Cheapest video-capable model first; fall through if one is busy or retired.
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];
const API = "https://generativelanguage.googleapis.com";

export function ytDlpPath(): string | null {
  const candidates = [process.env.YT_DLP_PATH, path.join(homedir(), ".local/bin/yt-dlp"), "/usr/local/bin/yt-dlp", "/opt/homebrew/bin/yt-dlp"];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export function isSupportedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /(^|\.)(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)$/.test(u.hostname);
  } catch {
    return false;
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out, err }); });
  });
}

// yt-dlp's errors are long; keep the line a person can act on.
function friendlyDlError(err: string): string {
  if (/login|log in|rate-limit|requires authentication|cookies/i.test(err)) return "That platform wants a login to download this one. Instagram does this a lot; TikTok links usually work.";
  if (/private|unavailable|removed|not available/i.test(err)) return "That video is private, deleted, or not available in the US.";
  if (/Unsupported URL/i.test(err)) return "That link isn't a single video. Open the video itself and copy its link.";
  const line = err.split("\n").reverse().find((l) => l.includes("ERROR")) ?? err.trim().split("\n").pop() ?? "";
  return `Couldn't download the video. ${line.replace(/^ERROR:\s*/, "").slice(0, 200)}`;
}

async function uploadToGemini(file: string, key: string): Promise<{ uri: string; mime: string; name: string }> {
  const bytes = await readFile(file);
  const mime = "video/mp4";
  const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: path.basename(file) } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload didn't start (${start.status}).`);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": String(bytes.length) },
    body: bytes,
  });
  const info = (await up.json()) as { file?: { uri: string; name: string; state: string } };
  if (!up.ok || !info.file) throw new Error(`Gemini upload failed (${up.status}).`);

  // Video has to finish processing before a model can read it.
  let state = info.file.state;
  for (let i = 0; i < 60 && state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = (await (await fetch(`${API}/v1beta/${info.file.name}?key=${key}`)).json()) as { state?: string };
    state = s.state ?? "FAILED";
  }
  if (state !== "ACTIVE") throw new Error("Gemini couldn't process the video file.");
  return { uri: info.file.uri, mime, name: info.file.name };
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    hook: { type: "STRING" },
    timeline: { type: "ARRAY", items: { type: "OBJECT", properties: { at: { type: "STRING" }, shows: { type: "STRING" } }, required: ["at", "shows"] } },
    spoken: { type: "STRING" },
    on_screen_text: { type: "STRING" },
    why_it_works: { type: "ARRAY", items: { type: "STRING" } },
    remake_idea: { type: "STRING" },
  },
  required: ["summary", "hook", "timeline", "spoken", "on_screen_text", "why_it_works", "remake_idea"],
};

type Meta = { caption: string | null; views: number | null; likes: number | null; creator: string | null; niche: string | null };

function prompt(meta: Meta) {
  const who = meta.niche
    ? `a creator whose niche is: ${JSON.stringify(meta.niche)}`
    : "a creator in a different niche (pick one that fits the format and name it)";
  return `You are watching a short-form social video so a creator can learn from it. Describe only what is actually seen and heard; never guess at things you can't observe.

Context from the post: creator ${meta.creator ?? "unknown"}, caption ${JSON.stringify(meta.caption ?? "")}, ${meta.views ?? "?"} views, ${meta.likes ?? "?"} likes.

Return JSON:
- summary: 2-3 plain sentences on what the video is about.
- hook: what happens in the first 3 seconds and why it stops the scroll.
- timeline: 4-10 beats, each with a timestamp like "0:04" and what is on screen (people, actions, setting, cuts, text).
- spoken: the words said, condensed if long. "No speech" if none. Note music if that's all there is.
- on_screen_text: captions/text overlays shown, or "None".
- why_it_works: 3-5 short, specific reasons it got attention (format, pacing, emotion, payoff, trend), tied to what you saw.
- remake_idea: one concrete way to remake this format for ${who}. Original content only: no copying the footage, no impersonating real people.
Write plainly, no hype.`;
}

async function analyze(fileUri: string, mime: string, meta: Meta, key: string): Promise<{ breakdown: ScanBreakdown; model: string }> {
  let lastErr = "";
  for (const model of MODELS) {
    const r = await fetch(`${API}/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ file_data: { mime_type: mime, file_uri: fileUri } }, { text: prompt(meta) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.4 },
      }),
    });
    if (!r.ok) {
      lastErr = `${model}: ${r.status}`;
      if ([404, 429, 500, 503].includes(r.status)) continue; // retired, rate-limited, or busy → next model
      break;
    }
    const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      return { breakdown: JSON.parse(text) as ScanBreakdown, model };
    } catch {
      lastErr = `${model}: unreadable response`;
    }
  }
  throw new Error(lastErr.includes("429") ? "Gemini's free daily limit is used up. Try again tomorrow." : `The AI step failed (${lastErr}).`);
}

export function cleanNiche(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  return t || null;
}

export async function scanVideo(url: string, niche: string | null = null): Promise<Scan> {
  const bin = ytDlpPath();
  if (!bin) throw new Error("yt-dlp isn't installed. See the README for the one-line install.");
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing. Add it to .env.local and restart.");

  const dir = await mkdtemp(path.join(tmpdir(), "vidscan-"));
  try {
    // One call: write metadata JSON + download a small single-file mp4 (no ffmpeg needed).
    const dl = await run(bin, [
      "--no-playlist", "--no-warnings", "--write-info-json", "--no-write-comments",
      "-f", "b[ext=mp4][acodec!=none][vcodec!=none][height<=720]/b[acodec!=none][vcodec!=none]/b",
      "--max-filesize", String(MAX_BYTES),
      "-o", path.join(dir, "video.%(ext)s"),
      url,
    ], 180_000);
    if (dl.code !== 0) throw new Error(friendlyDlError(dl.err));

    const files = await readdir(dir);
    const infoFile = files.find((f) => f.endsWith(".info.json"));
    const videoFile = files.find((f) => /\.(mp4|webm|mov|mkv)$/.test(f));
    if (!infoFile || !videoFile) throw new Error("The download finished but no video file came out. Try a different link.");
    const d = JSON.parse(await readFile(path.join(dir, infoFile), "utf8")) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v : null);
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    const ud = s(d.upload_date);

    const base: Scan = {
      id: `scan_${Date.now().toString(36)}`,
      url: s(d.webpage_url) ?? url,
      platform: s(d.extractor_key) ?? s(d.extractor) ?? "video",
      creator: s(d.uploader) ?? s(d.channel) ?? s(d.uploader_id),
      caption: s(d.description) ?? s(d.title),
      thumbnail: s(d.thumbnail),
      durationSec: n(d.duration),
      postedAt: ud ? `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}` : null,
      sound: [s(d.track), s(d.artist)].filter(Boolean).join(" · ") || null,
      stats: { views: n(d.view_count), likes: n(d.like_count), comments: n(d.comment_count), shares: n(d.repost_count) },
      breakdown: null,
      model: null,
      error: null,
      scannedAt: new Date().toISOString(),
    };

    // Stats are useful on their own — if the AI step fails, keep them and say why.
    try {
      const vpath = path.join(dir, videoFile);
      if ((await stat(vpath)).size === 0) throw new Error("Downloaded video was empty.");
      const up = await uploadToGemini(vpath, key);
      const { breakdown, model } = await analyze(up.uri, up.mime, { caption: base.caption, views: base.stats.views, likes: base.stats.likes, creator: base.creator, niche }, key);
      base.breakdown = { ...breakdown, niche };
      base.model = model;
      fetch(`${API}/v1beta/${up.name}?key=${key}`, { method: "DELETE" }).catch(() => {}); // tidy up Google's copy
    } catch (e) {
      base.error = e instanceof Error ? e.message : "The AI step failed.";
    }
    await saveScan(base);
    return base;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function loadScans(): Promise<Scan[]> {
  try {
    return JSON.parse(await readFile(SCANS_FILE, "utf8")) as Scan[];
  } catch {
    return [];
  }
}

async function saveScan(scan: Scan) {
  const all = [scan, ...(await loadScans()).filter((x) => x.url !== scan.url)].slice(0, MAX_HISTORY);
  await mkdir(path.dirname(SCANS_FILE), { recursive: true });
  await writeFile(SCANS_FILE, JSON.stringify(all, null, 2));
}

export async function deleteScan(id: string) {
  const all = (await loadScans()).filter((x) => x.id !== id);
  await mkdir(path.dirname(SCANS_FILE), { recursive: true });
  await writeFile(SCANS_FILE, JSON.stringify(all, null, 2));
}
