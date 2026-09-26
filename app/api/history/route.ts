import { NextResponse } from "next/server";
import { getStore, RAIN_SITE } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent agent questions plus hourly rollups from the continuous aggregate. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const site = params.get("site") ?? "01474500";
  const hours = Math.min(Number(params.get("hours") ?? 72), 24 * 30);
  const store = await getStore();
  try {
    const [queries, gage, turbidity, rain, stats, subscriptions] = await Promise.all([
      store.recentQueries(8),
      store.hourly(site, "gageFt", hours),
      store.hourly(site, "turbidityFnu", hours),
      store.hourly(RAIN_SITE, "precipMm", hours),
      store.stats(),
      store.countSubscriptions(),
    ]);
    return NextResponse.json({ storage: store.kind, stats, subscriptions, queries, hourly: { site, gage, turbidity, rain } });
  } catch (e) {
    return NextResponse.json({ storage: store.kind, error: (e as Error).message }, { status: 500 });
  }
}
