import "server-only";
import data from "@/fixtures/replays.json";
import type { AgentEvent, Emit } from "./events";

/**
 * Offline replay: real agent runs (Gemini + tools) recorded with their original timing by
 * scripts/record-replays.mjs, against the same fixtures the offline snapshot serves. Used as a
 * demo safety net when venue Wi-Fi, Gemini, or the database is unavailable.
 */
export interface Replay {
  id: string;
  question: string;
  demo: boolean;
  audio?: string;
  events: { ms: number; e: AgentEvent }[];
}

const file = data as unknown as { recordedAt: string | null; model: string | null; replays: Replay[] };

const norm = (q: string) =>
  q
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function findReplay(question: string, demo: boolean): Replay | undefined {
  return file.replays.find((r) => r.demo === demo && norm(r.question) === norm(question));
}

export function replayInfo() {
  return {
    recordedAt: file.recordedAt,
    model: file.model,
    questions: file.replays.map((r) => ({ question: r.question, demo: r.demo })),
  };
}

const MAX_GAP_MS = 3500; // keep long model pauses from dragging on stage

export async function playReplay(r: Replay, emit: Emit, speed = 1) {
  let prev = 0;
  for (const { ms, e } of r.events) {
    const gap = Math.min(ms - prev, MAX_GAP_MS) * speed;
    prev = ms;
    if (gap > 0) await new Promise((res) => setTimeout(res, gap));
    if (e.type === "meta") emit({ ...e, replay: { recordedAt: file.recordedAt ?? e.at } });
    else if (e.type === "final") emit({ ...e, audio: r.audio });
    else emit(e);
  }
}
