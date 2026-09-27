import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/events";

describe("Gemini transient errors", () => {
  it("retries a 503 'high demand' response instead of dropping to the offline agent", async () => {
    vi.stubEnv("FORCE_FIXTURES", "1");
    const { runGeminiAgent } = await import("@/lib/agent/gemini");
    const { getSnapshot } = await import("@/lib/conditions");
    let calls = 0;
    const generateContent = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
      return { candidates: [{ content: { role: "model", parts: [{ text: "All good.\n\n**Verdict:** Go." }] } }] };
    });
    const cfg = { ai: { models: { generateContent } }, backend: "gemini-api", models: ["gemini-3.8-flash"] } as never;
    const events: AgentEvent[] = [];
    const r = await runGeminiAgent("Is Boathouse Row safe?", { snap: await getSnapshot({ offline: true }) }, (e) => events.push(e), cfg);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(r.text).toMatch(/Verdict/);
    vi.unstubAllEnvs();
  });

  it("still gives up after repeated failures so the offline agent can take over", async () => {
    const { runGeminiAgent } = await import("@/lib/agent/gemini");
    const { getSnapshot } = await import("@/lib/conditions");
    const generateContent = vi.fn(async () => {
      throw new Error("429 RESOURCE_EXHAUSTED");
    });
    const cfg = { ai: { models: { generateContent } }, backend: "gemini-api", models: ["gemini-3.8-flash"] } as never;
    await expect(runGeminiAgent("q", { snap: await getSnapshot({ offline: true }) }, () => {}, cfg)).rejects.toThrow(/429/);
    expect(generateContent).toHaveBeenCalledTimes(3); // first try + 2 retries
  });
});
