export type ParamCode = "00065" | "00060" | "00010" | "63680" | "00300";

export const PARAMS: Record<ParamCode, { key: ParamKey; label: string; unit: string }> = {
  "00065": { key: "gageFt", label: "Gage height", unit: "ft" },
  "00060": { key: "dischargeCfs", label: "Discharge", unit: "cfs" },
  "00010": { key: "waterTempC", label: "Water temp", unit: "°C" },
  "63680": { key: "turbidityFnu", label: "Turbidity", unit: "FNU" },
  "00300": { key: "dissolvedOxygen", label: "Dissolved oxygen", unit: "mg/L" },
};

export type ParamKey = "gageFt" | "dischargeCfs" | "waterTempC" | "turbidityFnu" | "dissolvedOxygen";

export interface Point {
  t: number; // epoch ms
  v: number;
}

export interface GaugeData {
  siteId: string;
  siteName: string;
  series: Partial<Record<ParamKey, Point[]>>;
}

export interface RainPoint {
  t: number; // epoch ms, start of the hour
  mm: number;
}

export interface RainTotals {
  last6h: number; // inches
  last24h: number;
  last48h: number;
  last72h: number;
  next24h: number;
}

export type Band = "green" | "yellow" | "red";

export type Activity = "rowing" | "kayaking" | "fishing" | "wading" | "swimming" | "shore";

export const ACTIVITIES: Activity[] = ["rowing", "kayaking", "fishing", "wading", "swimming", "shore"];

export interface Reason {
  factor: string; // e.g. "cso", "turbidity"
  points: number;
  text: string;
  kind: "risk" | "warning" | "info" | "skipped";
}

export interface ActivityVerdict {
  activity: Activity;
  status: "go" | "caution" | "no-go";
  text: string;
}

export interface Assessment {
  spotId: string;
  spotName: string;
  score: number;
  band: Band;
  label: string; // Safe / Caution / Avoid
  at: string; // ISO time assessed for
  reasons: Reason[];
  verdicts: ActivityVerdict[];
  worsening: boolean;
  readings: Partial<Record<ParamKey, { value: number; at: string; siteId: string }>>;
  rain: RainTotals;
}

export interface SourceStatus {
  status: "live" | "cached" | "demo";
  asOf: string; // ISO of the data
  error?: string;
}

export interface ChartRow {
  t: number;
  rainIn: number;
  gageFt?: number;
  forecast?: boolean;
}
