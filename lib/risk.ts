import type { Spot } from "@/data/spots";
import { GAUGES } from "@/data/gauges";
import { rainTotals, sumBetween } from "./rain";
import type {
  Activity,
  ActivityVerdict,
  Assessment,
  Band,
  GaugeData,
  ParamKey,
  Point,
  RainPoint,
  Reason,
} from "./types";

const HOUR = 3600_000;

/** All thresholds live here so the README table and the code can't drift apart. */
export const THRESHOLDS = {
  csoHeavyIn: 0.5, // 24h rain that very likely triggers combined sewer overflows
  csoHeavyPts: 40,
  csoLightIn: 0.25, // 24h rain at which some outfalls start overflowing
  csoLightPts: 20,
  soaked48In: 1.0,
  soaked48Pts: 15,
  decayFullHours: 24, // CSO points held at full strength for 24h after the rain stops...
  decayZeroHours: 48, // ...then fade linearly to zero at 48h
  turbidityHighFnu: 50,
  turbidityHighPts: 20,
  turbiditySevereFnu: 100,
  turbiditySeverePts: 30,
  riseFt24h: 1.0,
  risePts: 15,
  dischargeMultiple: 3, // x monthly median
  dischargePts: 10,
  lowDoMgL: 5,
  lowDoPts: 5,
  coldShockC: 10,
  forecastWorsenIn: 0.5,
  staleHours: 6,
};

export const CSO_EXPOSURE = { high: 1.25, moderate: 1, low: 0.75 } as const;

export function bandFor(score: number): Band {
  if (score >= 67) return "red";
  if (score >= 34) return "yellow";
  return "green";
}

export const BAND_LABEL: Record<Band, string> = { green: "Safe", yellow: "Caution", red: "Avoid" };

const fmtIn = (n: number) => `${n.toFixed(2)} in`;

function latestAt(series: Point[] | undefined, at: number): Point | undefined {
  if (!series?.length) return undefined;
  let best: Point | undefined;
  for (const p of series) if (p.t <= at) best = p;
  return best;
}

function valueNear(series: Point[], t: number): Point | undefined {
  let best: Point | undefined;
  let bestD = Infinity;
  for (const p of series) {
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= 3 * HOUR ? best : undefined;
}

/**
 * CSO factor with a 48-hour decay. We look at every hour that had rain in the last 72h,
 * total the 24h window ending at that hour, and weight it by how long ago the rain stopped:
 * full weight for 24h, fading linearly to zero at 48h. The worst (max) window wins.
 */
export function csoFactor(rain: RainPoint[], at: number): { points: number; reason?: Reason } {
  const T = THRESHOLDS;
  let best = { points: 0, total: 0, hoursAgo: 0 };
  for (const p of rain) {
    if (p.mm <= 0 || p.t > at || p.t < at - 72 * HOUR) continue;
    const total = sumBetween(rain, p.t - 24 * HOUR, p.t);
    const base = total >= T.csoHeavyIn ? T.csoHeavyPts : total >= T.csoLightIn ? T.csoLightPts : 0;
    if (!base) continue;
    const hoursAgo = (at - p.t) / HOUR;
    const w =
      hoursAgo <= T.decayFullHours
        ? 1
        : Math.max(0, (T.decayZeroHours - hoursAgo) / (T.decayZeroHours - T.decayFullHours));
    const pts = Math.round(base * w);
    if (pts > best.points || (pts === best.points && pts > 0 && total > best.total))
      best = { points: pts, total, hoursAgo };
  }
  if (!best.points) return { points: 0 };
  const severity = best.total >= T.csoHeavyIn ? "likely" : "possible";
  const when =
    best.hoursAgo < 1 ? "is falling now" : `ended ~${Math.round(best.hoursAgo)}h ago`;
  const decayed = best.hoursAgo > T.decayFullHours ? " (fading: sewage lingers ~48h after rain)" : "";
  return {
    points: best.points,
    reason: {
      factor: "cso",
      points: best.points,
      kind: "risk",
      text: `Sewage overflow ${severity}: ${fmtIn(best.total)} of rain in 24h (${when}). Philly's combined sewers typically overflow after ${T.csoLightIn}–${T.csoHeavyIn} in${decayed}.`,
    },
  };
}

interface Inputs {
  spot: Spot;
  gauges: Record<string, GaugeData>;
  rain: RainPoint[];
  now: number; // time of the latest data / wall clock
  at?: number; // time we are assessing for (defaults to now)
}

export function assessSpot({ spot, gauges, rain, now, at = now }: Inputs): Assessment {
  const T = THRESHOLDS;
  const reasons: Reason[] = [];
  let score = 0;
  const add = (r: Reason) => {
    reasons.push(r);
    score += r.points;
  };

  const future = at > now + HOUR;
  const primary = gauges[spot.gauge];
  const fallback = spot.fallbackGauge ? gauges[spot.fallbackGauge] : undefined;
  const meta = GAUGES[spot.gauge];

  // Pick each parameter from the primary gauge, else the fallback gauge.
  const readings: Assessment["readings"] = {};
  const seriesFor = (k: ParamKey): { series: Point[]; siteId: string } | undefined => {
    const p = primary?.series[k];
    if (p?.length) return { series: p, siteId: spot.gauge };
    const f = fallback?.series[k];
    if (f?.length && spot.fallbackGauge) return { series: f, siteId: spot.fallbackGauge };
    return undefined;
  };
  const read = (k: ParamKey) => {
    const s = seriesFor(k);
    const p = latestAt(s?.series, now);
    if (s && p) readings[k] = { value: p.v, at: new Date(p.t).toISOString(), siteId: s.siteId };
    return s && p ? { point: p, siteId: s.siteId, series: s.series } : undefined;
  };

  // 1. Rain / combined sewer overflow
  const totals = rainTotals(rain, at);
  const cso = csoFactor(rain, at);
  if (cso.reason) {
    const mult = CSO_EXPOSURE[spot.csoExposure];
    const pts = Math.round(cso.points * mult);
    const note =
      spot.csoExposure === "high"
        ? " Many outfalls drain near this spot, so risk is weighted up."
        : spot.csoExposure === "low"
          ? " Few outfalls drain directly here, so risk is weighted down."
          : "";
    add({ ...cso.reason, points: pts, text: cso.reason.text + note });
  }
  if (totals.last48h >= T.soaked48In)
    add({
      factor: "rain48",
      points: T.soaked48Pts,
      kind: "risk",
      text: `${fmtIn(totals.last48h)} in the last 48h: saturated ground, so more runoff reaches the river.`,
    });
  if (!cso.reason && totals.last48h < T.soaked48In)
    reasons.push({
      factor: "cso",
      points: 0,
      kind: "info",
      text: `Little recent rain (${fmtIn(totals.last24h)} in 24h, ${fmtIn(totals.last72h)} in 72h), so a sewage overflow is unlikely.`,
    });

  // 2. Turbidity
  const turb = read("turbidityFnu");
  if (!turb)
    reasons.push({
      factor: "turbidity",
      points: 0,
      kind: "skipped",
      text: "Turbidity isn't reported at this gauge, so that factor was skipped.",
    });
  else {
    const v = turb.point.v;
    const src = turb.siteId !== spot.gauge ? ` (from ${GAUGES[turb.siteId]?.name ?? turb.siteId})` : "";
    if (v > T.turbiditySevereFnu)
      add({ factor: "turbidity", points: T.turbiditySeverePts, kind: "risk", text: `Very murky water: turbidity ${v} FNU${src}, above ${T.turbiditySevereFnu}. Runoff and sediment are pouring in.` });
    else if (v > T.turbidityHighFnu)
      add({ factor: "turbidity", points: T.turbidityHighPts, kind: "risk", text: `Murky water: turbidity ${v} FNU${src}, above ${T.turbidityHighFnu}.` });
    else reasons.push({ factor: "turbidity", points: 0, kind: "info", text: `Water is clear-ish: turbidity ${v} FNU${src}.` });
  }

  // 3. Gauge rise rate (meaningless on tidal gauges, which swing several feet twice a day)
  const gage = read("gageFt");
  if (meta?.tidal)
    reasons.push({ factor: "rise", points: 0, kind: "skipped", text: "Gauge rise rate skipped: this gauge is tidal, so water level swings with the tide." });
  else if (gage) {
    const prior = valueNear(gage.series, gage.point.t - 24 * HOUR);
    if (prior) {
      const rise = +(gage.point.v - prior.v).toFixed(2);
      if (rise > T.riseFt24h)
        add({ factor: "rise", points: T.risePts, kind: "risk", text: `River up ${rise} ft in 24h: fast water and floating debris.` });
      else reasons.push({ factor: "rise", points: 0, kind: "info", text: `River level steady (${rise >= 0 ? "+" : ""}${rise} ft in 24h, now ${gage.point.v} ft).` });
    }
  } else reasons.push({ factor: "rise", points: 0, kind: "skipped", text: "No gage height reported, so the rise-rate factor was skipped." });

  // 4. Discharge vs. seasonal median
  const q = read("dischargeCfs");
  const median = meta?.monthlyMedianCfs?.[new Date(now).getUTCMonth()];
  if (q && median && !meta?.tidal) {
    const ratio = q.point.v / median;
    if (ratio >= T.dischargeMultiple)
      add({ factor: "discharge", points: T.dischargePts, kind: "risk", text: `Flow is ${ratio.toFixed(1)}× normal for this month (${Math.round(q.point.v).toLocaleString()} cfs vs ~${median.toLocaleString()} median).` });
    else reasons.push({ factor: "discharge", points: 0, kind: "info", text: `Flow ${Math.round(q.point.v).toLocaleString()} cfs (${ratio.toFixed(1)}× the monthly median).` });
  }

  // 5. Dissolved oxygen
  const doR = read("dissolvedOxygen");
  if (doR && doR.point.v < T.lowDoMgL)
    add({ factor: "oxygen", points: T.lowDoPts, kind: "risk", text: `Low dissolved oxygen (${doR.point.v} mg/L): a sign of organic pollution, and hard on fish.` });

  // 6. Water temperature (warning only)
  const temp = read("waterTempC");
  if (temp && temp.point.v < T.coldShockC)
    reasons.push({ factor: "cold", points: 0, kind: "warning", text: `Cold water (${temp.point.v} °C): cold-shock risk if you capsize. Dress for immersion.` });

  // 7. Forecast
  const worsening = totals.next24h > T.forecastWorsenIn;
  if (worsening)
    reasons.push({ factor: "forecast", points: 0, kind: "warning", text: `${fmtIn(totals.next24h)} of rain forecast in the next 24h, so conditions are likely to worsen.` });

  // Context notes
  if (future)
    reasons.push({ factor: "projection", points: 0, kind: "info", text: `Projected for ${new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" })} using forecast rain; river gauges are today's readings, so treat this as a best guess.` });
  if (spot.tidal)
    reasons.push({ factor: "tide", points: 0, kind: "info", text: "Tidal reach: the tide pushes water (and any sewage) back and forth twice a day, so conditions here can differ from the gauge. Treat this as approximate." });
  const newest = Math.max(0, ...Object.values(readings).map((r) => Date.parse(r!.at)));
  if (!newest)
    reasons.push({ factor: "data", points: 0, kind: "warning", text: "No gauge data is available for this spot right now, so this score is based on rainfall only." });
  else if (now - newest > T.staleHours * HOUR)
    reasons.push({ factor: "data", points: 0, kind: "warning", text: `Gauge data is ${Math.round((now - newest) / HOUR)}h old.` });

  score = Math.max(0, Math.min(100, score));
  const band = bandFor(score);
  return {
    spotId: spot.id,
    spotName: spot.name,
    score,
    band,
    label: BAND_LABEL[band],
    at: new Date(at).toISOString(),
    reasons,
    verdicts: spot.activities.map((a) => verdictFor(a, score, { cold: !!(temp && temp.point.v < T.coldShockC), tidal: spot.tidal })),
    worsening,
    readings,
    rain: totals,
  };
}

// How much river contact each activity implies: max score for "go" and for "caution".
const TOLERANCE: Record<Exclude<Activity, "swimming">, [number, number]> = {
  shore: [66, 85], // walking, running, cycling: no water contact
  rowing: [33, 60], // in a shell, occasional splash
  fishing: [40, 70], // hands in water; don't eat the catch after a CSO
  kayaking: [28, 55], // paddle drip, rolls, launches
  wading: [15, 33], // skin contact: people wading, dogs swimming
};

const ACTIVITY_NOUN: Record<Activity, string> = {
  shore: "Walking & running",
  rowing: "Rowing",
  fishing: "Fishing",
  kayaking: "Kayaking",
  wading: "Wading & dogs",
  swimming: "Swimming",
};

export function verdictFor(activity: Activity, score: number, ctx: { cold?: boolean; tidal?: boolean } = {}): ActivityVerdict {
  if (activity === "swimming")
    return { activity, status: "no-go", text: "Swimming is never recommended in the Schuylkill or Delaware: sewage, currents, and boat traffic, even on clear days." };
  const [go, caution] = TOLERANCE[activity];
  const noun = ACTIVITY_NOUN[activity];
  let v: ActivityVerdict;
  if (score <= go) v = { activity, status: "go", text: `${noun}: looks OK.` };
  else if (score <= caution) v = { activity, status: "caution", text: `${noun}: go with caution. Avoid contact with the water and wash your hands after.` };
  else if (activity === "shore")
    // No water contact, so never a hard no; the danger is flooded, slippery paths.
    v = { activity, status: "caution", text: `${noun}: fine on the trail, but stay back from the water's edge. Low paths may flood.` };
  else v = { activity, status: "no-go", text: `${noun}: avoid for now. Wait for the water to clear.` };
  if (activity === "fishing" && score > go) v.text += " Don't eat what you catch.";
  if (activity === "wading" && v.status !== "go") v.text += " Keep dogs out of the water.";
  if (ctx.cold && (activity === "kayaking" || activity === "rowing")) v.text += " The water is cold, so wear immersion gear.";
  return v;
}

export { ACTIVITY_NOUN };
