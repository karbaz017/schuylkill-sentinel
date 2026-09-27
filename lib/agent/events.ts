import type { Band } from "@/lib/types";

export type AgentEvent =
  | { type: "meta"; mode: "gemini" | "mock"; model?: string; backend?: string; demo: boolean; at: string; replay?: { recordedAt: string } }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; result: unknown; ms: number }
  | { type: "final"; text: string; verdict?: { spotId: string; spotName: string; band: Band; score: number; label: string }; audio?: string }
  | { type: "error"; message: string }
  | { type: "done"; ms: number };

export type Emit = (e: AgentEvent) => void;
