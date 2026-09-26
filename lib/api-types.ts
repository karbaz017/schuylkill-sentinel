import type { Assessment, ChartRow, RainTotals, SourceStatus } from "./types";

export interface ConditionsResponse {
  generatedAt: string;
  now: number;
  demo: boolean;
  sources: { usgs: SourceStatus; rain: SourceStatus };
  rainTotals: RainTotals;
  assessments: Assessment[];
  charts: Record<string, ChartRow[]>;
  storage: "timescale" | "postgres" | "memory";
  capabilities: { agent: "gemini" | "mock"; agentBackend?: string; tts: "elevenlabs" | "browser" };
}
