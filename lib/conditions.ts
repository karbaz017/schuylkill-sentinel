import "server-only";
import usgsFixture from "@/fixtures/usgs.json";
import rainFixture from "@/fixtures/rain.json";
import fixtureMeta from "@/fixtures/meta.json";
import { SPOTS, type Spot } from "@/data/spots";
import { GAUGES } from "@/data/gauges";
import { latestTime, parseUsgs, USGS_URL, type UsgsResponse } from "./usgs";
import { parseRain, rainTotals, rainUrl, type OpenMeteoResponse } from "./rain";
import { assessSpot } from "./risk";
import { applyStorm } from "./scenario";
import { recordReadings } from "./db";
import type { Assessment, GaugeData, Point, RainPoint, RainTotals, SourceStatus } from "./types";

const HOUR = 3600_000;
const TTL = 5 * 60_000;
const TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS ?? 8000);

export interface Snapshot {
  generatedAt: string;
  now: number; // anchor time used for scoring
  demo: boolean;
  sources: { usgs: SourceStatus; rain: SourceStatus };
  gauges: Record<string, GaugeData>;
  rain: RainPoint[];
  rainTotals: RainTotals;
  assessments: Assessment[];
}

async function getJson<T>(url: string): Promise<T> {
  if (process.env.FORCE_FIXTURES === "1") throw new Error("FORCE_FIXTURES=1");
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadUsgs(): Promise<{ gauges: Record<string, GaugeData>; status: SourceStatus }> {
  try {
    const gauges = parseUsgs(await getJson<UsgsResponse>(USGS_URL));
    const t = latestTime(gauges);
    if (!t) throw new Error("USGS returned no data");
    return { gauges, status: { status: "live", asOf: new Date(t).toISOString() } };
  } catch (e) {
    const gauges = parseUsgs(usgsFixture as unknown as UsgsResponse);
    return {
      gauges,
      status: { status: "cached", asOf: new Date(latestTime(gauges)).toISOString(), error: String((e as Error).message) },
    };
  }
}

export async function loadRain(lat?: number, lng?: number): Promise<{ rain: RainPoint[]; status: SourceStatus }> {
  try {
    const rain = parseRain(await getJson<OpenMeteoResponse>(rainUrl(lat, lng)));
    if (!rain.length) throw new Error("Open-Meteo returned no data");
    return { rain, status: { status: "live", asOf: new Date().toISOString() } };
  } catch (e) {
    return {
      rain: parseRain(rainFixture as OpenMeteoResponse),
      status: { status: "cached", asOf: fixtureMeta.fetchedAt, error: String((e as Error).message) },
    };
  }
}

const cache = new Map<string, { at: number; snap: Promise<Snapshot> }>();

export function getSnapshot(opts: { demo?: boolean } = {}): Promise<Snapshot> {
  const key = opts.demo ? "demo" : "live";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.snap;
  const snap = buildSnapshot(!!opts.demo).catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), snap });
  return snap;
}

export function clearSnapshotCache() {
  cache.clear();
}

async function buildSnapshot(demo: boolean): Promise<Snapshot> {
  let gauges: Record<string, GaugeData>;
  let rain: RainPoint[];
  let sources: Snapshot["sources"];
  const wall = Date.now();

  if (demo) {
    const fx = parseUsgs(usgsFixture as unknown as UsgsResponse);
    const storm = applyStorm(fx, parseRain(rainFixture as OpenMeteoResponse), Date.parse(fixtureMeta.fetchedAt), wall);
    gauges = storm.gauges;
    rain = storm.rain;
    const asOf = new Date(latestTime(gauges)).toISOString();
    sources = { usgs: { status: "demo", asOf }, rain: { status: "demo", asOf } };
  } else {
    const [u, r] = await Promise.all([loadUsgs(), loadRain()]);
    gauges = u.gauges;
    rain = r.rain;
    sources = { usgs: u.status, rain: r.status };
    // Persist live observations into the time-series store (fire-and-forget).
    if (u.status.status === "live" || r.status.status === "live")
      recordReadings(u.status.status === "live" ? gauges : {}, r.status.status === "live" ? rain.filter((p) => p.t <= wall) : []).catch(
        (e) => console.warn("[db] recordReadings failed:", (e as Error).message),
      );
  }

  // When everything is cached, score relative to when the cache was taken, not the wall clock,
  // so rolling rain windows still line up with the data.
  const now =
    sources.usgs.status === "cached" && sources.rain.status === "cached"
      ? Math.min(wall, Math.max(Date.parse(fixtureMeta.fetchedAt), latestTime(gauges)))
      : wall;

  return {
    generatedAt: new Date(wall).toISOString(),
    now,
    demo,
    sources,
    gauges,
    rain,
    rainTotals: rainTotals(rain, now),
    assessments: SPOTS.map((spot) => assessSpot({ spot, gauges, rain, now })),
  };
}

export function assessAt(snap: Snapshot, spot: Spot, at: number): Assessment {
  const horizon = Math.max(...snap.rain.map((p) => p.t));
  return assessSpot({ spot, gauges: snap.gauges, rain: snap.rain, now: snap.now, at: Math.min(at, horizon) });
}

/** Hourly averages for the last `hours` hours, for charts and the agent. */
export function hourly(series: Point[] | undefined, now: number, hours = 72): Point[] {
  if (!series?.length) return [];
  const buckets = new Map<number, { s: number; n: number }>();
  for (const p of series) {
    if (p.t < now - hours * HOUR || p.t > now) continue;
    const b = Math.floor(p.t / HOUR) * HOUR;
    const e = buckets.get(b) ?? { s: 0, n: 0 };
    e.s += p.v;
    e.n++;
    buckets.set(b, e);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, e]) => ({ t, v: +(e.s / e.n).toFixed(2) }));
}

export interface ChartRow {
  t: number;
  rainIn: number;
  gageFt?: number;
  forecast?: boolean;
}

/** 72h of hourly rain + gauge for a spot's gauge, plus the next 24h of forecast rain. */
export function chartRows(snap: Snapshot, siteId: string): ChartRow[] {
  const gage = new Map(hourly(snap.gauges[siteId]?.series.gageFt, snap.now).map((p) => [p.t, p.v]));
  return snap.rain
    .filter((p) => p.t > snap.now - 72 * HOUR && p.t <= snap.now + 24 * HOUR)
    .map((p) => ({
      t: p.t,
      rainIn: +(p.mm / 25.4).toFixed(3),
      gageFt: gage.get(p.t - HOUR) ?? gage.get(p.t),
      forecast: p.t > snap.now,
    }));
}

export function gaugeName(id: string) {
  return GAUGES[id]?.name ?? id;
}
