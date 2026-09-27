import { NextResponse } from "next/server";
import { chartRows, getSnapshot, type Snapshot } from "@/lib/conditions";
import { GAUGES } from "@/data/gauges";
import { getStore, memoryStore, RAIN_SITE, type Store } from "@/lib/db";
import type { ChartRow } from "@/lib/types";
import { geminiConfig } from "@/lib/agent/gemini";
import { replayInfo } from "@/lib/agent/replay";
import type { ConditionsResponse } from "@/lib/api-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const demo = params.get("demo") === "1";
  const replay = params.get("replay") === "1";
  const snap = await getSnapshot({ demo, offline: replay });
  // Replay must work with no network: don't let a slow DB connection hold up the page.
  const store = replay
    ? await Promise.race([getStore(), new Promise<Store>((r) => setTimeout(() => r(memoryStore()), 1500))])
    : await getStore();
  let charts = Object.fromEntries(Object.keys(GAUGES).map((id) => [id, chartRows(snap, id)]));
  let chartSource: ConditionsResponse["chartSource"] = "app";
  if (!demo && !replay && store.kind !== "memory") {
    try {
      charts = await dbCharts(store, snap);
      chartSource = store.kind;
    } catch (e) {
      console.warn("[db] chart query failed, using in-app rollup:", (e as Error).message);
    }
  }
  const gemini = geminiConfig();
  const body: ConditionsResponse = {
    generatedAt: snap.generatedAt,
    now: snap.now,
    demo: snap.demo,
    sources: snap.sources,
    rainTotals: snap.rainTotals,
    assessments: snap.assessments,
    charts,
    storage: store.kind,
    chartSource,
    replay: replay ? replayInfo() : undefined,
    capabilities: {
      agent: gemini ? "gemini" : "mock",
      agentBackend: gemini?.backend,
      tts: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser",
    },
  };
  return NextResponse.json(body);
}

const HOUR = 3600_000;

/** 72h chart straight from the readings_hourly continuous aggregate, plus forecast rain from the snapshot. */
async function dbCharts(store: Store, snap: Snapshot): Promise<Record<string, ChartRow[]>> {
  const rain = await store.hourly(RAIN_SITE, "precipMm", 72);
  if (!rain.length) throw new Error("no rain rows yet");
  const forecast = snap.rain.filter((p) => p.t > snap.now && p.t <= snap.now + 24 * HOUR);
  const out: Record<string, ChartRow[]> = {};
  for (const id of Object.keys(GAUGES)) {
    const gage = new Map((await store.hourly(id, "gageFt", 73)).map((r) => [Date.parse(r.bucket), r.avg]));
    out[id] = [
      ...rain.map((r) => {
        const t = Date.parse(r.bucket);
        return { t, rainIn: +(r.sum / 25.4).toFixed(3), gageFt: gage.get(t - HOUR) ?? gage.get(t) };
      }),
      ...forecast.map((p) => ({ t: p.t, rainIn: +(p.mm / 25.4).toFixed(3), forecast: true })),
    ];
  }
  return out;
}
