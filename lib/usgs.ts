import { PARAMS, type GaugeData, type ParamCode, type Point } from "./types";
import { GAUGE_IDS } from "@/data/gauges";

export const USGS_URL =
  "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=" +
  GAUGE_IDS.join(",") +
  "&parameterCd=00065,00060,00010,63680,00300&siteStatus=all&period=P3D";

interface UsgsValue {
  value: string;
  dateTime: string;
}
interface UsgsTimeSeries {
  sourceInfo: { siteName: string; siteCode: { value: string }[] };
  variable: { variableCode: { value: string }[]; noDataValue: number | null };
  values: { value: UsgsValue[] }[];
}
export interface UsgsResponse {
  value: { timeSeries: UsgsTimeSeries[] };
}

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Parse the USGS Instantaneous Values JSON into per-site series. Only keeps parameters that actually have data. */
export function parseUsgs(json: UsgsResponse): Record<string, GaugeData> {
  const out: Record<string, GaugeData> = {};
  for (const ts of json?.value?.timeSeries ?? []) {
    const siteId = ts.sourceInfo.siteCode[0]?.value;
    const code = ts.variable.variableCode[0]?.value as ParamCode;
    const param = PARAMS[code];
    if (!siteId || !param) continue;
    const noData = ts.variable.noDataValue ?? -999999;
    // A site can publish several method series for one parameter; keep the one with the freshest data.
    let best: Point[] = [];
    for (const block of ts.values ?? []) {
      const pts = (block.value ?? [])
        .map((v) => ({ t: Date.parse(v.dateTime), v: Number(v.value) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v !== noData)
        .sort((a, b) => a.t - b.t);
      if (pts.length && (!best.length || pts[pts.length - 1].t > best[best.length - 1].t)) best = pts;
    }
    out[siteId] ??= { siteId, siteName: decode(ts.sourceInfo.siteName), series: {} };
    if (best.length) out[siteId].series[param.key] = best;
  }
  return out;
}

export function latestTime(gauges: Record<string, GaugeData>): number {
  let t = 0;
  for (const g of Object.values(gauges))
    for (const s of Object.values(g.series)) if (s?.length) t = Math.max(t, s[s.length - 1].t);
  return t;
}
