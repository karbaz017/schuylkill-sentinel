"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { SPOTS } from "@/data/spots";
import type { ConditionsResponse } from "@/lib/api-types";
import AgentPanel from "./AgentPanel";
import SpotCard from "./SpotCard";
import SubscribeForm from "./SubscribeForm";

const RiverMap = dynamic(() => import("./RiverMap"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full !rounded-none" />,
});

const REFRESH_MS = 5 * 60_000;

const fmtTime = (t: string | number) =>
  new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

export default function Dashboard() {
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<ConditionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string>("bartrams-garden");
  const [flyTo, setFlyTo] = useState<string>();
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const load = useCallback(async (demoMode: boolean) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/conditions${demoMode ? "?demo=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get("demo") === "1") setDemo(true);
    } catch {}
  }, []);

  useEffect(() => {
    load(demo);
    const id = setInterval(() => load(demo), REFRESH_MS);
    return () => clearInterval(id);
  }, [demo, load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  const a = data?.assessments.find((x) => x.spotId === selected);
  const spot = SPOTS.find((s) => s.id === selected)!;
  const cached = data && (data.sources.usgs.status === "cached" || data.sources.rain.status === "cached");

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col px-4 sm:px-6">
      <Header data={data} demo={demo} setDemo={setDemo} loading={loading} />

      {demo && (
        <Banner tone="demo">
          <b>Demo mode:</b> cached gauge data with a simulated 1.6″ thunderstorm that ended 6 hours ago. Watch the map turn red.
        </Banner>
      )}
      {!demo && cached && data && (
        <Banner tone="warn">
          Live feed unreachable. Showing cached{" "}
          {data.sources.usgs.status === "cached" && data.sources.rain.status === "cached"
            ? "USGS and rainfall"
            : data.sources.usgs.status === "cached"
              ? "USGS"
              : "rainfall"}{" "}
          data from {fmtTime(data.sources.usgs.status === "cached" ? data.sources.usgs.asOf : data.sources.rain.asOf)}.
        </Banner>
      )}
      {failed && !data && <Banner tone="warn">Couldn&apos;t reach the server. Retrying every 5 minutes.</Banner>}

      <main className="grid flex-1 grid-cols-1 gap-4 pb-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="panel relative overflow-hidden">
            <div className="h-[340px] w-full sm:h-[440px]">
              <RiverMap
                assessments={data?.assessments ?? []}
                selected={selected}
                onSelect={(id) => setSelected(id)}
                flyTo={flyTo}
              />
            </div>
            <Legend />
          </div>

          <SpotStrip data={data} selected={selected} onSelect={setSelected} />

          {a && data ? (
            <SpotCard a={a} rows={data.charts[spot.gauge] ?? []} now={data.now} />
          ) : (
            <div className="panel space-y-3 p-5">
              <div className="flex gap-4">
                <div className="skeleton h-16 w-16 !rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-2/3" />
                  <div className="skeleton h-3 w-full" />
                </div>
              </div>
              <div className="skeleton h-20" />
              <div className="skeleton h-[132px]" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <AgentPanel
            demo={demo}
            mode={data?.capabilities.agent}
            onVerdict={(id) => {
              setSelected(id);
              setFlyTo(id);
            }}
          />
          <SubscribeForm key={selected} defaultSpot={selected} onToast={(msg, kind = "ok") => setToast({ msg, kind })} />
        </div>
      </main>

      <footer className="border-t border-line py-5 text-center text-xs text-faint">
        Built at OwlHacks 2026 · Data: USGS, Open-Meteo · Not official guidance.
        <span className="mx-1.5">·</span>
        <a href="https://github.com/karbaz017/schuylkill-sentinel" className="hover:text-muted">Source</a>
      </footer>

      {toast && (
        <div
          role="status"
          className={`rise-in fixed bottom-4 left-1/2 z-[1000] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
            toast.kind === "ok" ? "border-safe/40 bg-[#062019]/90 text-ink" : "border-avoid/40 bg-[#240a12]/90 text-ink"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Header({
  data,
  demo,
  setDemo,
  loading,
}: {
  data: ConditionsResponse | null;
  demo: boolean;
  setDemo: (d: boolean) => void;
  loading: boolean;
}) {
  const s = data?.sources;
  const badge = (label: string, status?: string, title?: string) => (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "live" ? "bg-safe shadow-[0_0_8px_var(--green)]" : status === "cached" ? "bg-caution" : status === "demo" ? "bg-accent-2" : "bg-faint"
        }`}
      />
      {label}
    </span>
  );
  return (
    <header className="relative pb-4 pt-5 sm:pt-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Logo />
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[28px]">
              {process.env.NEXT_PUBLIC_APP_NAME || "Schuylkill Sentinel"}
            </h1>
          </div>
          <p className="mt-1.5 max-w-[62ch] text-sm text-muted sm:text-[15px]">
            Know before you go: live sewage-overflow and river-safety risk for Philly&apos;s waterfronts.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-full border border-line bg-white/[0.03] py-1 pl-3 pr-1 text-xs">
            <span className={demo ? "text-accent-2" : "text-muted"}>⛈ Demo: storm</span>
            <input type="checkbox" className="peer sr-only" checked={demo} onChange={(e) => setDemo(e.target.checked)} aria-label="Demo mode: simulate a storm" />
            <span className="relative h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-accent-2/70 peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition peer-checked:after:translate-x-4" />
          </label>
          <p className="text-[11px] text-faint" aria-live="polite">
            {loading && !data ? "Loading live data…" : data ? `Updated ${fmtTime(data.generatedAt)}${loading ? " · refreshing…" : ""}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {badge("USGS gauges", s?.usgs.status, s && `${s.usgs.status} · data as of ${fmtTime(s.usgs.asOf)}`)}
        {badge("Open-Meteo rain", s?.rain.status, s && `${s.rain.status} · as of ${fmtTime(s.rain.asOf)}`)}
        {badge(data?.capabilities.agent === "gemini" ? "Gemini agent" : "Offline agent", data ? (data.capabilities.agent === "gemini" ? "live" : "cached") : undefined)}
        {badge(
          data?.storage === "timescale" ? "Tiger Data" : data?.storage === "postgres" ? "Postgres" : "In-memory store",
          data ? (data.storage === "memory" ? "cached" : "live") : undefined,
          "Where readings, traces and alerts are stored",
        )}
        {badge(data?.capabilities.tts === "elevenlabs" ? "ElevenLabs voice" : "Browser voice", data ? (data.capabilities.tts === "elevenlabs" ? "live" : "cached") : undefined)}
      </div>

      <svg className="pointer-events-none absolute -bottom-1 left-0 h-3 w-full overflow-hidden opacity-60" viewBox="0 0 1200 12" preserveAspectRatio="none" aria-hidden>
        <g className="wave">
          <path d="M0 6 Q 25 0 50 6 T 100 6 T 150 6 T 200 6 T 250 6 T 300 6 T 350 6 T 400 6 T 450 6 T 500 6 T 550 6 T 600 6 T 650 6 T 700 6 T 750 6 T 800 6 T 850 6 T 900 6 T 950 6 T 1000 6 T 1050 6 T 1100 6 T 1150 6 T 1200 6 T 1250 6 T 1300 6 T 1350 6 T 1400 6 T 1450 6 T 1500 6 T 1550 6 T 1600 6 T 1650 6 T 1700 6 T 1750 6 T 1800 6 T 1850 6 T 1900 6 T 1950 6 T 2000 6 T 2050 6 T 2100 6 T 2150 6 T 2200 6 T 2250 6 T 2300 6 T 2350 6 T 2400 6" stroke="var(--accent)" strokeWidth="1" fill="none" />
        </g>
      </svg>
    </header>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0a1624" stroke="rgba(126,184,222,.3)" />
      <path d="M16 5 L25 9 V16 C25 21.5 21 25.5 16 27 C11 25.5 7 21.5 7 16 V9 Z" fill="none" stroke="url(#lg)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M10.5 17.5 Q13 15.5 15.5 17.5 T20.5 17.5" stroke="url(#lg)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M11.5 21 Q13.5 19.5 16 21 T20 21" stroke="#38bdf8" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

function Banner({ tone, children }: { tone: "warn" | "demo"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={`rise-in mb-4 rounded-xl border px-4 py-2.5 text-sm ${
        tone === "warn" ? "border-caution/40 bg-caution/10 text-caution" : "border-accent-2/40 bg-accent-2/10 text-accent-2"
      }`}
    >
      {children}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[500] flex gap-1.5 rounded-full border border-line bg-[#030811]/80 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-safe" />Safe</span>
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-caution" />Caution</span>
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-avoid" />Avoid</span>
    </div>
  );
}

function SpotStrip({ data, selected, onSelect }: { data: ConditionsResponse | null; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-6">
      {SPOTS.map((s) => {
        const a = data?.assessments.find((x) => x.spotId === s.id);
        const active = s.id === selected;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            aria-pressed={active}
            className={`band-${a?.band ?? "green"} group flex min-w-[150px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition sm:min-w-0 ${
              active ? "border-[var(--band)] bg-white/[0.06]" : "border-line bg-white/[0.02] hover:border-[var(--line-strong)] hover:bg-white/[0.04]"
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a ? "var(--band)" : "var(--faint)", boxShadow: a ? "0 0 10px var(--band)" : undefined }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ink">{s.name.split(" (")[0].split(" / ")[0]}</span>
              <span className="block text-[10px] text-faint">{a ? `${a.label} · ${a.score}` : "…"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
