import type { GaugeData, Point, RainPoint } from "./types";

const HOUR = 3600_000;

/**
 * Demo "storm" scenario: a 1.6 in thunderstorm that ended ~6 hours before `now`,
 * with the rivers responding the way they do after a real summer storm:
 * turbidity spikes, the gauge climbs, and flow jumps several-fold.
 * Timestamps are shifted so the fixture looks like it was fetched at `now`.
 */
export function applyStorm(
  gauges: Record<string, GaugeData>,
  rain: RainPoint[],
  dataTime: number,
  now: number,
): { gauges: Record<string, GaugeData>; rain: RainPoint[] } {
  const shift = now - dataTime;
  const stormEnd = now - 6 * HOUR;
  const stormStart = stormEnd - 10 * HOUR;
  // Bell-ish storm shape, total ~1.6 in (40.6 mm) plus light showers forecast tomorrow.
  const profile = [1, 2, 4, 7, 9, 7, 5, 3, 1.6, 1];
  const shiftedRain = rain.map((p) => {
    const t = p.t + shift;
    let mm = 0;
    if (t > stormStart && t <= stormEnd) mm = profile[Math.floor((t - stormStart - 1) / HOUR)] ?? 0;
    else if (t > now + 14 * HOUR && t <= now + 18 * HOUR) mm = 4; // ~0.6 in more tomorrow
    return { t, mm };
  });

  const response = (t: number) => {
    // 0 before the storm, ramps up to 1 at stormEnd+2h, slowly recedes.
    if (t < stormStart + 3 * HOUR) return 0;
    const peak = stormEnd + 2 * HOUR;
    if (t <= peak) return (t - stormStart - 3 * HOUR) / (peak - stormStart - 3 * HOUR);
    return Math.max(0.5, 1 - (t - peak) / (30 * HOUR));
  };

  const out: Record<string, GaugeData> = {};
  for (const [id, g] of Object.entries(gauges)) {
    const bump = (s: Point[] | undefined, f: (v: number, r: number) => number) =>
      s?.map((p) => {
        const t = p.t + shift;
        return { t, v: +f(p.v, response(t)).toFixed(2) };
      });
    const tidal = id === "01467200";
    // The Delaware at Trenton drains a huge watershed mostly outside the storm, so it barely reacts.
    const big = id === "01463500";
    out[id] = {
      ...g,
      series: {
        gageFt: bump(g.series.gageFt, (v, r) => v + r * (tidal ? 0.8 : big ? 0.5 : 2.6)),
        dischargeCfs: bump(g.series.dischargeCfs, (v, r) => (tidal ? v : v * (1 + r * (big ? 0.8 : 5)))),
        turbidityFnu: bump(g.series.turbidityFnu, (v, r) => v + r * (tidal ? 90 : big ? 25 : 160)),
        waterTempC: bump(g.series.waterTempC, (v) => v),
        dissolvedOxygen: bump(g.series.dissolvedOxygen, (v, r) => v - r * 2.5),
      },
    };
    for (const k of Object.keys(out[id].series) as (keyof GaugeData["series"])[])
      if (!out[id].series[k]) delete out[id].series[k];
  }
  return { gauges: out, rain: shiftedRain };
}
