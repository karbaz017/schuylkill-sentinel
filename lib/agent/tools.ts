import "server-only";
import { SPOTS, getSpot } from "@/data/spots";
import { GAUGES } from "@/data/gauges";
import { ACTIVITIES, PARAMS, type Activity, type ParamKey } from "@/lib/types";
import { assessAt, hourly, loadRain, type Snapshot } from "@/lib/conditions";
import { PHILLY, rainTotals } from "@/lib/rain";
import { getStore } from "@/lib/db";
import { verdictFor } from "@/lib/risk";
import { fmtNY, parseWhen } from "@/lib/time";

export interface ToolCtx {
  snap: Snapshot;
}

type Args = Record<string, unknown>;

export const TOOL_DECLARATIONS = [
  {
    name: "list_spots",
    description: "List the Philadelphia riverfront spots Schuylkill Sentinel monitors, with ids, river, tidal flag, nearest USGS gauge, and typical uses.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_river_conditions",
    description:
      "Latest USGS gauge readings (gage height ft, discharge cfs, water temp °C, turbidity FNU, dissolved oxygen mg/L) plus a 72-hour hourly series. Not every site reports every parameter.",
    parametersJsonSchema: {
      type: "object",
      properties: { siteId: { type: "string", description: "USGS site number, e.g. 01474500 (Schuylkill at Fairmount Dam)", enum: Object.keys(GAUGES) } },
      required: ["siteId"],
    },
  },
  {
    name: "get_rainfall",
    description: "Rainfall totals in inches for the last 6/24/48/72 hours and the next 24 hours of forecast (Open-Meteo), plus an hourly forecast.",
    parametersJsonSchema: {
      type: "object",
      properties: { lat: { type: "number" }, lng: { type: "number" } },
      required: ["lat", "lng"],
    },
  },
  {
    name: "assess_spot",
    description:
      "Run the Schuylkill Sentinel risk model for one spot and activity at a given time. Returns score 0-100, band (green/yellow/red), every contributing reason, and activity verdicts. Future times use forecast rain.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        spotId: { type: "string", enum: SPOTS.map((s) => s.id) },
        activity: { type: "string", enum: ACTIVITIES, description: "shore = walking/running/cycling; wading = people wading or dogs in the water" },
        when: { type: "string", description: "ISO 8601 time in America/New_York, or 'now'" },
      },
      required: ["spotId", "activity"],
    },
  },
  {
    name: "subscribe_alert",
    description: "Subscribe an email to alerts when a spot reaches a risk band. Stored in the database; delivery is mocked for this demo.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        spotId: { type: "string", enum: SPOTS.map((s) => s.id) },
        threshold: { type: "string", enum: ["yellow", "red"] },
      },
      required: ["email", "spotId"],
    },
  },
];

export type ToolName = "list_spots" | "get_river_conditions" | "get_rainfall" | "assess_spot" | "subscribe_alert";

export interface ToolOutput {
  result: unknown;
  summary: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function runTool(name: string, args: Args, ctx: ToolCtx): Promise<ToolOutput> {
  const { snap } = ctx;
  switch (name as ToolName) {
    case "list_spots": {
      const spots = SPOTS.map((s) => ({
        id: s.id,
        name: s.name,
        river: s.river,
        tidal: s.tidal,
        gauge: s.gauge,
        uses: s.uses,
        currentBand: snap.assessments.find((a) => a.spotId === s.id)?.band,
      }));
      return { result: { spots }, summary: `${spots.length} spots: ${spots.map((s) => s.name.split(" /")[0]).join(", ")}` };
    }

    case "get_river_conditions": {
      const siteId = String(args.siteId ?? "");
      const g = snap.gauges[siteId];
      if (!g) return { result: { error: `No data for site ${siteId}`, available: Object.keys(snap.gauges) }, summary: `No data for ${siteId}` };
      const latest: Record<string, unknown> = {};
      const series: Record<string, [string, number][]> = {};
      for (const [k, s] of Object.entries(g.series) as [ParamKey, { t: number; v: number }[]][]) {
        const last = s[s.length - 1];
        const unit = Object.values(PARAMS).find((p) => p.key === k)!.unit;
        latest[k] = { value: last.v, unit, at: fmtNY(last.t) };
        // Every 3rd hour keeps the payload small for the model.
        series[k] = hourly(s, snap.now)
          .filter((_, i, a) => (a.length - 1 - i) % 3 === 0)
          .map((p) => [fmtNY(p.t, { weekday: "short", hour: "numeric" }), p.v]);
      }
      const missing = Object.values(PARAMS).filter((p) => !(p.key in g.series)).map((p) => p.label);
      const bits = [
        latest.gageFt && `${(latest.gageFt as { value: number }).value} ft`,
        latest.dischargeCfs && `${Math.round((latest.dischargeCfs as { value: number }).value).toLocaleString()} cfs`,
        latest.turbidityFnu && `${(latest.turbidityFnu as { value: number }).value} FNU`,
        latest.waterTempC && `${(latest.waterTempC as { value: number }).value} °C`,
      ].filter(Boolean);
      return {
        result: {
          siteId,
          name: GAUGES[siteId]?.name ?? g.siteName,
          tidal: GAUGES[siteId]?.tidal ?? false,
          source: snap.sources.usgs,
          latest,
          notReported: missing,
          series72hEvery3h: series,
        },
        summary: `${GAUGES[siteId]?.name ?? g.siteName}: ${bits.join(" · ")}${snap.sources.usgs.status !== "live" ? ` (${snap.sources.usgs.status})` : ""}`,
      };
    }

    case "get_rainfall": {
      const lat = Number(args.lat ?? PHILLY.lat);
      const lng = Number(args.lng ?? PHILLY.lng);
      const nearPhilly = Math.abs(lat - PHILLY.lat) < 0.3 && Math.abs(lng - PHILLY.lng) < 0.3;
      let rain = snap.rain;
      let source = snap.sources.rain;
      if (!nearPhilly && !snap.demo) ({ rain, status: source } = await loadRain(lat, lng));
      const totals = rainTotals(rain, snap.now);
      const forecast = rain
        .filter((p) => p.t > snap.now && p.t <= snap.now + 36 * 3600_000 && p.mm > 0)
        .map((p) => [fmtNY(p.t, { weekday: "short", hour: "numeric" }), +(p.mm / 25.4).toFixed(2)]);
      return {
        result: { unit: "inches", ...totals, forecastRainyHours: forecast, source, gridPoint: nearPhilly ? "Philadelphia (39.97, -75.18)" : `${lat}, ${lng}` },
        summary: `24h ${totals.last24h}″ · 48h ${totals.last48h}″ · 72h ${totals.last72h}″ · next 24h ${totals.next24h}″`,
      };
    }

    case "assess_spot": {
      const spot = getSpot(String(args.spotId ?? ""));
      if (!spot) return { result: { error: `Unknown spot ${args.spotId}`, validIds: SPOTS.map((s) => s.id) }, summary: `Unknown spot ${args.spotId}` };
      const activity = (ACTIVITIES.includes(args.activity as Activity) ? args.activity : "shore") as Activity;
      const when = parseWhen(args.when as string | undefined, snap.now);
      const a = assessAt(snap, spot, when.t);
      const verdict =
        a.verdicts.find((v) => v.activity === activity) ??
        // Activities we don't normally list for a spot still get a verdict.
        verdictFor(activity, a.score, { tidal: spot.tidal });
      return {
        result: {
          spotId: spot.id,
          spotName: spot.name,
          activity,
          assessedFor: when.label,
          score: a.score,
          band: a.band,
          label: a.label,
          activityVerdict: verdict,
          reasons: a.reasons.map((r) => `${r.points ? `+${r.points} ` : ""}[${r.kind}] ${r.text}`),
          worsening: a.worsening,
          rainInches: a.rain,
          dataStatus: { usgs: snap.sources.usgs.status, rain: snap.sources.rain.status },
        },
        summary: `${spot.name} → ${a.score}/100 ${a.label.toUpperCase()} · ${activity}: ${verdict.status}`,
      };
    }

    case "subscribe_alert": {
      const email = String(args.email ?? "").trim().toLowerCase();
      const spot = getSpot(String(args.spotId ?? ""));
      const threshold = args.threshold === "yellow" ? "yellow" : "red";
      if (!EMAIL.test(email)) return { result: { ok: false, error: "That doesn't look like a valid email." }, summary: "Invalid email" };
      if (!spot) return { result: { ok: false, error: "Unknown spot" }, summary: "Unknown spot" };
      const store = await getStore();
      const saved = await store.upsertSubscription({ email, spotId: spot.id, threshold, createdAt: new Date().toISOString() });
      return {
        result: { ok: true, id: saved.id, email, spot: spot.name, threshold, storage: store.kind, note: "Alert delivery is mocked in this demo; no email is sent." },
        summary: `Subscribed ${email} to ${spot.name} at ${threshold.toUpperCase()} (${store.kind})`,
      };
    }
  }
  return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}` };
}
