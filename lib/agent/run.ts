import "server-only";
import { SPOTS } from "@/data/spots";
import { getSnapshot } from "@/lib/conditions";
import { getStore } from "@/lib/db";
import type { AgentEvent, Emit } from "./events";
import { geminiConfig, runGeminiAgent } from "./gemini";
import { runMockAgent } from "./mock";

/** Runs one agent turn end to end, emitting events, then persists the trace. */
export async function runAgent(question: string, opts: { demo?: boolean }, sink: Emit) {
  const started = Date.now();
  const trace: AgentEvent[] = [];
  const emit: Emit = (e) => {
    trace.push(e);
    sink(e);
  };
  const snap = await getSnapshot({ demo: opts.demo });
  const ctx = { snap };
  const cfg = geminiConfig();
  let mode: "gemini" | "mock" = "mock";
  let model: string | undefined;
  let answer: string | undefined;

  if (cfg) {
    try {
      const r = await runGeminiAgent(question, ctx, emit, cfg);
      mode = "gemini";
      model = r.model;
      answer = r.text;
      emit({ type: "final", text: r.text, verdict: verdictFrom(trace, r.text) });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      console.warn("[agent] Gemini failed, falling back to offline agent:", msg.slice(0, 300));
      const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(msg);
      emit({ type: "meta", mode: "mock", demo: snap.demo, at: new Date().toISOString() });
      answer = await runMockAgent(
        question,
        ctx,
        emit,
        quota ? "Gemini quota is exhausted, so I'm switching to the offline agent." : "Gemini is unreachable, so I'm switching to the offline agent.",
      );
    }
  } else {
    emit({ type: "meta", mode: "mock", demo: snap.demo, at: new Date().toISOString() });
    answer = await runMockAgent(question, ctx, emit);
  }
  emit({ type: "done", ms: Date.now() - started });

  getStore()
    .then((s) => s.insertQuery({ createdAt: new Date().toISOString(), question, mode, model, answer, trace, latencyMs: Date.now() - started }))
    .catch((e) => console.warn("[db] insertQuery failed:", e.message));
  return { trace, answer, mode };
}

/** Pick the assessed spot the final answer is about, for the verdict badge. */
function verdictFrom(trace: AgentEvent[], text: string) {
  const assessed = trace.filter(
    (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.name === "assess_spot" && e.ok,
  );
  if (!assessed.length) return undefined;
  const verdictLine = text.split("\n").reverse().find((l) => /verdict/i.test(l)) ?? text;
  const mentioned = (line: string) =>
    assessed.find((e) => {
      const name = String((e.result as { spotName?: string }).spotName ?? "");
      const spot = SPOTS.find((s) => s.name === name);
      return spot && line.toLowerCase().includes(name.split(/[ /(]/)[0].toLowerCase().replace("'s", ""));
    });
  const hit = mentioned(verdictLine) ?? mentioned(text.split("\n")[0]) ?? (assessed.length === 1 ? assessed[0] : undefined);
  if (!hit) return undefined;
  const r = hit.result as { spotId: string; spotName: string; band: "green" | "yellow" | "red"; score: number; label: string };
  return { spotId: r.spotId, spotName: r.spotName, band: r.band, score: r.score, label: r.label };
}
