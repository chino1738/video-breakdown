"use client";

import { useEffect, useState } from "react";
import type { Scan } from "@/lib/vidscan";

type Ready = { ytDlp: boolean; geminiKey: boolean };

const fmt = (n: number | null) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

const STEPS = ["Downloading the video", "Uploading it to the model", "Watching frames and audio", "Writing the breakdown"];

export default function Home() {
  const [url, setUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [open, setOpen] = useState<Scan | null>(null);

  useEffect(() => {
    try { setNiche(localStorage.getItem("vb-niche") ?? ""); } catch {}
    fetch("/api/scan").then((r) => r.json()).then((d) => { setReady(d.ready); setScans(d.scans ?? []); setOpen(d.scans?.[0] ?? null); });
  }, []);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(id);
  }, [busy]);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { localStorage.setItem("vb-niche", niche); } catch {}
    try {
      const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, niche }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Scan failed.");
      setScans((s) => [d.scan, ...s.filter((x) => x.id !== d.scan.id)]);
      setOpen(d.scan);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch("/api/scan", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setScans((s) => s.filter((x) => x.id !== id));
    if (open?.id === id) setOpen(null);
  }

  const notReady = ready && (!ready.ytDlp || !ready.geminiKey);

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "40px 16px 80px" }}>
      <header className="rise" style={{ marginBottom: 28 }}>
        <div className="label">video breakdown</div>
        <h1 style={{ fontSize: "clamp(2.1rem, 7vw, 3.6rem)", lineHeight: 1, margin: "10px 0 12px", letterSpacing: "-0.03em", fontWeight: 700 }}>
          Why did that video<br /><span style={{ color: "var(--hot)" }}>actually work?</span>
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 17, maxWidth: 560 }}>
          Paste a TikTok, Reel, or Short. A model watches it and breaks down the hook, every beat, and how to remake the format for your niche.
        </p>
      </header>

      {notReady && (
        <div className="card mono" style={{ padding: 14, marginBottom: 16, borderColor: "var(--hot)", fontSize: 13 }}>
          {!ready!.ytDlp && <div>✗ yt-dlp not found. Install it (see README).</div>}
          {!ready!.geminiKey && <div>✗ GEMINI_API_KEY missing from .env.local.</div>}
        </div>
      )}

      <form onSubmit={scan} className="card rise" style={{ padding: 14, display: "grid", gap: 10, animationDelay: "60ms" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input className="field" style={{ flex: "1 1 320px" }} type="url" inputMode="url" placeholder="https://www.tiktok.com/@creator/video/…"
            value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Video link" required />
          <button className="go" disabled={busy}>{busy ? "Watching…" : "Break it down"}</button>
        </div>
        <input className="field" placeholder="Your niche (optional), e.g. budget meal prep, home renovation, thrift flips"
          value={niche} onChange={(e) => setNiche(e.target.value)} aria-label="Your niche" maxLength={120} />
        {busy && (
          <div style={{ display: "grid", gap: 8, paddingTop: 4 }}>
            <div className="scan-bar" />
            <div className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>{STEPS[step]}… usually under a minute or two</div>
          </div>
        )}
        {error && <div className="mono" style={{ color: "var(--hot)", fontSize: 13 }}>{error}</div>}
      </form>

      {open && <Breakdown s={open} />}

      {scans.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <div className="label" style={{ marginBottom: 12 }}>history</div>
          <div style={{ display: "grid", gap: 8 }}>
            {scans.map((s) => (
              <div key={s.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, borderColor: open?.id === s.id ? "var(--hot)" : "var(--line)" }}>
                <button onClick={() => { setOpen(s); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                  {s.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.thumbnail} alt="" referrerPolicy="no-referrer" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                    : <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--panel-2)", flexShrink: 0 }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.creator ?? s.platform}</span>
                    <span className="mono" style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{s.platform} · {fmt(s.stats.views)} views · {fmt(s.stats.likes)} likes</span>
                  </span>
                </button>
                <button onClick={() => remove(s.id)} aria-label="Delete scan" style={{ background: "none", border: 0, color: "var(--muted)", fontSize: 18, padding: 8 }}>×</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mono" style={{ marginTop: 48, fontSize: 12, color: "var(--muted)" }}>
        Runs on your machine with yt-dlp and Gemini. Breakdowns describe only what&apos;s seen and heard.
      </footer>
    </main>
  );
}

function Breakdown({ s }: { s: Scan }) {
  const b = s.breakdown;
  return (
    <article className="rise" style={{ marginTop: 22, display: "grid", gap: 12 }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <a href={s.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 20, textDecoration: "none" }}>{s.creator ?? "Unknown creator"} ↗</a>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{s.platform}{s.postedAt ? ` · ${s.postedAt}` : ""}{s.durationSec ? ` · ${Math.round(s.durationSec)}s` : ""}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
          {([["views", s.stats.views], ["likes", s.stats.likes], ["comments", s.stats.comments], ["shares", s.stats.shares]] as const).map(([k, v]) => (
            <div key={k} style={{ background: "var(--panel-2)", borderRadius: 12, padding: "10px 10px" }}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmt(v)}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>{k}</div>
            </div>
          ))}
        </div>
        {s.error && <div className="mono" style={{ color: "var(--hot)", fontSize: 13, marginTop: 12 }}>AI step failed: {s.error}</div>}
      </div>

      {b && (
        <>
          <Section title="the hook · first 3 seconds"><p style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>{b.hook}</p></Section>
          <Section title="what it is"><p style={{ margin: 0, color: "#cfcdc6" }}>{b.summary}</p></Section>
          <Section title="beat by beat">
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
              {b.timeline.map((t, i) => (
                <li key={i} style={{ display: "grid", gridTemplateColumns: "58px 1fr", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <span className="mono" style={{ color: "var(--hot)", fontSize: 13, paddingTop: 2 }}>{t.at}</span>
                  <span>{t.shows}</span>
                </li>
              ))}
            </ol>
          </Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <Section title="why it works">
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>{b.why_it_works.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Section>
            <Section title={b.niche ? `remake it · ${b.niche}` : "remake it"} accent>
              <p style={{ margin: 0 }}>{b.remake_idea}</p>
            </Section>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <Section title="spoken"><p style={{ margin: 0, color: "#cfcdc6", whiteSpace: "pre-wrap" }}>{b.spoken}</p></Section>
            <Section title="on-screen text"><p style={{ margin: 0, color: "#cfcdc6", whiteSpace: "pre-wrap" }}>{b.on_screen_text}</p></Section>
          </div>
          {s.model && <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>model: {s.model}</div>}
        </>
      )}
    </article>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <section className="card" style={{ padding: 16, ...(accent ? { borderColor: "var(--hot)", background: "linear-gradient(180deg, var(--hot-soft), var(--panel) 70%)" } : {}) }}>
      <div className="label" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}
