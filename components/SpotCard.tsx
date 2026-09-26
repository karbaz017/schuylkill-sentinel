"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SPOTS } from "@/data/spots";
import { GAUGES } from "@/data/gauges";
import type { Assessment, ChartRow, Reason } from "@/lib/types";

const MiniChart = dynamic(() => import("./MiniChart"), { ssr: false, loading: () => <div className="skeleton h-[132px]" /> });

const STATUS_STYLE = {
  go: { dot: "bg-safe", text: "text-safe", label: "Go" },
  caution: { dot: "bg-caution", text: "text-caution", label: "Caution" },
  "no-go": { dot: "bg-avoid", text: "text-avoid", label: "No" },
} as const;

const ACTIVITY_ICON: Record<string, string> = {
  rowing: "🚣",
  kayaking: "🛶",
  fishing: "🎣",
  wading: "🐕",
  swimming: "🏊",
  shore: "🚶",
};

const REASON_ICON: Record<Reason["kind"], string> = { risk: "▲", warning: "!", info: "·", skipped: "∅" };

export function ScoreRing({ score, band, size = 64 }: { score: number; band: string; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <div className={`band-${band} relative shrink-0`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={5} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--band)"
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(score, 2) / 100)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 6px var(--band))" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-lg font-bold leading-none">{score}</span>
      </div>
    </div>
  );
}

export default function SpotCard({ a, rows, now, chartSource }: { a: Assessment; rows: ChartRow[]; now: number; chartSource?: string }) {
  const spot = SPOTS.find((s) => s.id === a.spotId)!;
  const [showAll, setShowAll] = useState(false);
  const risks = a.reasons.filter((r) => r.kind === "risk" || r.kind === "warning");
  const others = a.reasons.filter((r) => r.kind === "info" || r.kind === "skipped");
  const collapsed = risks.length ? risks : others.slice(0, 1);
  const r = a.readings;
  const stats: [string, string | undefined][] = [
    ["Gauge", r.gageFt && `${r.gageFt.value.toFixed(2)} ft`],
    ["Flow", r.dischargeCfs && `${Math.round(r.dischargeCfs.value).toLocaleString()} cfs`],
    ["Turbidity", r.turbidityFnu && `${r.turbidityFnu.value} FNU`],
    ["Water", r.waterTempC && `${r.waterTempC.value.toFixed(1)} °C`],
    ["Rain 24h", `${a.rain.last24h.toFixed(2)}″`],
    ["Next 24h", `${a.rain.next24h.toFixed(2)}″`],
  ];

  return (
    <article className={`panel band-${a.band} rise-in overflow-hidden`} key={a.spotId + a.score}>
      <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--band), transparent)" }} />
      <div className="p-4 sm:p-5">
        <header className="flex items-start gap-4">
          <ScoreRing score={a.score} band={a.band} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold leading-tight">{a.spotName}</h2>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#03101a]" style={{ background: "var(--band)" }}>
                {a.label}
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">right now</span>
              {a.worsening && <span className="rounded-full border border-caution/40 px-2 py-0.5 text-[11px] text-caution">↗ worsening</span>}
            </div>
            <p className="mt-1 text-xs text-muted">
              {spot.river} River{spot.tidal ? " · tidal" : ""} · gauge {GAUGES[spot.gauge]?.name.replace(/ \(.*\)/, "")} · {spot.blurb}
            </p>
          </div>
        </header>

        <ul className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {a.verdicts.map((v) => (
            <li key={v.activity} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-xs" title={v.text}>
              <span aria-hidden>{ACTIVITY_ICON[v.activity]}</span>
              <span className="capitalize text-muted">{v.activity === "shore" ? "walk/run" : v.activity === "wading" ? "dogs/wade" : v.activity}</span>
              <span className={`ml-auto flex items-center gap-1 font-semibold ${STATUS_STYLE[v.status].text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[v.status].dot}`} />
                {STATUS_STYLE[v.status].label}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Why</h3>
          <ul className="space-y-1.5 text-sm">
            {(showAll ? [...risks, ...others] : collapsed).map((x, i) => (
              <ReasonRow key={i} r={x} />
            ))}
          </ul>
          {a.reasons.length > collapsed.length && (
            <button onClick={() => setShowAll((s) => !s)} className="mt-1.5 text-xs text-accent hover:underline">
              {showAll ? "Hide details" : `Show all ${a.reasons.length} factors`}
            </button>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-6">
          {stats.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-faint">{k}</dt>
              <dd className="truncate font-mono text-xs text-ink">{v ?? "n/a"}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-faint">
            <span>
              72h rain + gauge · next 24h forecast
              {chartSource === "timescale" && <span className="ml-1.5 normal-case tracking-normal text-accent/80">· Tiger Data continuous aggregate</span>}
            </span>
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <i className="inline-block h-2 w-2 rounded-sm bg-accent-2" /> rain
              <i className="inline-block h-0.5 w-3 bg-accent" /> gauge
            </span>
          </div>
          <MiniChart rows={rows} now={now} tidal={GAUGES[spot.gauge]?.tidal} />
        </div>
      </div>
    </article>
  );
}

function ReasonRow({ r }: { r: Reason }) {
  const color =
    r.kind === "risk" ? "text-[var(--band)]" : r.kind === "warning" ? "text-caution" : r.kind === "skipped" ? "text-faint" : "text-muted";
  return (
    <li className="flex gap-2">
      <span className={`mt-0.5 w-4 shrink-0 text-center font-mono text-xs ${color}`} aria-hidden>
        {REASON_ICON[r.kind]}
      </span>
      <span className={r.kind === "skipped" ? "text-faint" : r.kind === "info" ? "text-muted" : "text-ink/90"}>
        {r.text}
        {r.points > 0 && <span className="ml-1.5 font-mono text-[11px] text-faint">+{r.points}</span>}
      </span>
    </li>
  );
}
