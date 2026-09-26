import type { RainPoint, RainTotals } from "./types";

export const PHILLY = { lat: 39.97, lng: -75.18 };

export function rainUrl(lat = PHILLY.lat, lng = PHILLY.lng) {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}` +
    `&hourly=precipitation&past_days=3&forecast_days=2&timezone=America%2FNew_York`
  );
}

export interface OpenMeteoResponse {
  utc_offset_seconds: number;
  hourly: { time: string[]; precipitation: (number | null)[] };
}

export const MM_PER_IN = 25.4;
const HOUR = 3600_000;

/** Open-Meteo returns local wall-clock times plus a UTC offset; convert to epoch ms. */
export function parseRain(json: OpenMeteoResponse): RainPoint[] {
  const off = (json.utc_offset_seconds ?? 0) * 1000;
  return json.hourly.time
    .map((t, i) => ({ t: Date.parse(t + ":00Z") - off, mm: Number(json.hourly.precipitation[i] ?? 0) }))
    .filter((p) => Number.isFinite(p.t));
}

/**
 * Open-Meteo hourly precipitation is the sum over the *preceding* hour, labelled by the hour's end.
 * We treat a point at time t as rain that has fallen by t.
 */
export function sumBetween(points: RainPoint[], from: number, to: number): number {
  let mm = 0;
  for (const p of points) if (p.t > from && p.t <= to) mm += p.mm;
  return mm / MM_PER_IN;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function rainTotals(points: RainPoint[], now: number): RainTotals {
  return {
    last6h: r2(sumBetween(points, now - 6 * HOUR, now)),
    last24h: r2(sumBetween(points, now - 24 * HOUR, now)),
    last48h: r2(sumBetween(points, now - 48 * HOUR, now)),
    last72h: r2(sumBetween(points, now - 72 * HOUR, now)),
    next24h: r2(sumBetween(points, now, now + 24 * HOUR)),
  };
}
