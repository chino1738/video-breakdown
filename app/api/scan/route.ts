import { NextResponse } from "next/server";
import { cleanNiche, deleteScan, isSupportedUrl, loadScans, scanVideo, ytDlpPath } from "@/lib/vidscan";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    ready: { ytDlp: !!ytDlpPath(), geminiKey: !!process.env.GEMINI_API_KEY },
    scans: await loadScans(),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; niche?: string };
  const url = (body.url ?? "").trim();
  if (!isSupportedUrl(url)) {
    return NextResponse.json({ error: "Paste a TikTok, Instagram, or YouTube video link." }, { status: 400 });
  }
  try {
    const scan = await scanVideo(url, cleanNiche(body.niche));
    return NextResponse.json({ scan });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Scan failed." }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id || !/^scan_[a-z0-9]+$/.test(id)) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await deleteScan(id);
  return NextResponse.json({ ok: true });
}
