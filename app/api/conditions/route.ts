import { NextResponse } from "next/server";
import { chartRows, getSnapshot } from "@/lib/conditions";
import { GAUGES } from "@/data/gauges";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const demo = new URL(req.url).searchParams.get("demo") === "1";
  const snap = await getSnapshot({ demo });
  const store = await getStore();
  const charts = Object.fromEntries(Object.keys(GAUGES).map((id) => [id, chartRows(snap, id)]));
  return NextResponse.json({
    generatedAt: snap.generatedAt,
    now: snap.now,
    demo: snap.demo,
    sources: snap.sources,
    rainTotals: snap.rainTotals,
    assessments: snap.assessments,
    charts,
    storage: store.kind,
  });
}
