import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { fmtNY, isoNY, nyAt } from "@/lib/time";
import type { Emit } from "./events";
import { TOOL_DECLARATIONS, runTool, type ToolCtx } from "./tools";

const MAX_STEPS = 8;
const MAX_RETRIES = 2; // per run, for 503 "high demand" / 429 spikes

export function geminiConfig(): { ai: GoogleGenAI; backend: "gemini-api" | "vertex"; models: string[] } | null {
  const models = [...new Set([process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest"].filter(Boolean) as string[])];
  if (process.env.AGENT_MODE === "mock") return null;
  if (process.env.GEMINI_API_KEY) return { ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }), backend: "gemini-api", models };
  if (process.env.GOOGLE_CLOUD_PROJECT)
    return {
      ai: new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        // Gemini 3.x flash models are served from the global endpoint.
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
      }),
      backend: "vertex",
      models,
    };
  return null;
}

export function systemPrompt(now: number, demo: boolean) {
  return `You are Schuylkill Sentinel, a river-safety assistant for Philadelphia's Schuylkill and Delaware rivers.
After heavy rain, Philadelphia's combined sewers overflow raw sewage into the rivers (CSO events). You help rowers, kayakers, anglers, and dog walkers decide whether to go.

Rules:
- Always call tools to get data. Never guess readings, rainfall, or scores. Use assess_spot for every verdict: its score and band are the source of truth.
- Typical plan: get_rainfall, then get_river_conditions for the spot's gauge, then assess_spot. For "which spot" questions, call assess_spot for every relevant spot (you may call tools in parallel).
- Convert times like "tomorrow morning" to an ISO 8601 time in America/New_York (morning = 8 AM) for assess_spot's "when".
- Be concise: 2–5 short sentences or bullets, in plain language. Mention the one or two reasons that matter most (rain amount, turbidity, etc.).
- Never encourage swimming or wading. Swimming is never recommended in these rivers; if asked, decline clearly and explain why.
- For tidal spots (Bartram's Garden, Schuylkill Banks, Penn's Landing, Tacony), note that tides make conditions approximate.
- If data is missing, cached, or a factor was skipped, say so plainly.
- End with exactly one line starting with "**Verdict:**" and a one-sentence go / caution / avoid call.

Current time: ${fmtNY(now, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} (ISO ${isoNY(now)}). For example, "tomorrow morning" is ${isoNY(nyAt(now, 1, 8))}.${demo ? "\nDEMO MODE: data is a simulated storm scenario. You may mention that it is a demo." : ""}`;
}

function thinkingFor(model: string) {
  if (/gemini-2\./.test(model)) return { includeThoughts: true, thinkingBudget: 1024 };
  // MEDIUM: Gemini 3.8 skips thought summaries on tool-calling turns at LOW, and the trace needs them.
  const level = (process.env.GEMINI_THINKING_LEVEL ?? "MEDIUM").toUpperCase() as keyof typeof ThinkingLevel;
  return { includeThoughts: true, thinkingLevel: ThinkingLevel[level] ?? ThinkingLevel.MEDIUM };
}

/** Runs the Gemini function-calling loop, emitting trace events. Throws on API failure so the caller can fall back. */
export async function runGeminiAgent(question: string, ctx: ToolCtx, emit: Emit, cfg: NonNullable<ReturnType<typeof geminiConfig>>) {
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  let modelIdx = 0;
  let emittedMeta = false;
  let retries = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const model = cfg.models[modelIdx];
    let resp;
    try {
      resp = await cfg.ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt(ctx.snap.now, ctx.snap.demo),
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          thinkingConfig: thinkingFor(model),
          temperature: 0.3,
        },
      });
    } catch (e) {
      const msg = String((e as Error).message);
      // Model not available on this endpoint/key: try the next one before giving up.
      if (step === 0 && /404|not found|NOT_FOUND/i.test(msg) && modelIdx < cfg.models.length - 1) {
        modelIdx++;
        step--;
        continue;
      }
      // Transient overload / rate limit: back off and retry the same turn a couple of times.
      if (/\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg) && retries < MAX_RETRIES) {
        retries++;
        await new Promise((r) => setTimeout(r, 1200 * retries));
        step--;
        continue;
      }
      throw e;
    }
    if (!emittedMeta) {
      emit({ type: "meta", mode: "gemini", model, backend: cfg.backend, demo: ctx.snap.demo, at: new Date().toISOString() });
      emittedMeta = true;
    }

    const content = resp.candidates?.[0]?.content;
    const parts: Part[] = content?.parts ?? [];
    for (const p of parts) if (p.thought && p.text) emit({ type: "thought", text: p.text.trim() });
    const text = parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("")
      .trim();
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (!calls.length) {
      if (!text) throw new Error(`Gemini returned no answer (finishReason: ${resp.candidates?.[0]?.finishReason ?? "unknown"})`);
      return { text, model };
    }
    if (text) emit({ type: "thought", text });

    // Keep the model's turn verbatim (it carries thought signatures Gemini 3 requires).
    contents.push(content!);
    const responses: Part[] = await Promise.all(
      calls.map(async (c, i) => {
        const id = c.id ?? `call-${step}-${i}`;
        const args = (c.args ?? {}) as Record<string, unknown>;
        emit({ type: "tool_call", id, name: c.name!, args });
        const t0 = Date.now();
        try {
          const out = await runTool(c.name!, args, ctx);
          emit({ type: "tool_result", id, name: c.name!, ok: true, summary: out.summary, result: out.result, ms: Date.now() - t0 });
          return { functionResponse: { id: c.id, name: c.name, response: { result: out.result } } };
        } catch (e) {
          const error = String((e as Error).message);
          emit({ type: "tool_result", id, name: c.name!, ok: false, summary: `Error: ${error}`, result: { error }, ms: Date.now() - t0 });
          return { functionResponse: { id: c.id, name: c.name, response: { error } } };
        }
      }),
    );
    contents.push({ role: "user", parts: responses });
  }
  throw new Error("Agent hit the step limit without a final answer");
}
