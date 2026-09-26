import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/events";

async function readEvents(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function ask(question: string, demo = false) {
  const { POST } = await import("@/app/api/agent/route");
  const res = await POST(new Request("http://x/api/agent", { method: "POST", body: JSON.stringify({ question, demo }) }));
  expect(res.headers.get("content-type")).toMatch(/ndjson/);
  return readEvents(res);
}

const finalOf = (ev: AgentEvent[]) => ev.find((e) => e.type === "final") as Extract<AgentEvent, { type: "final" }>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("FORCE_FIXTURES", "1"); // never touch the network in tests
  vi.stubEnv("AGENT_MODE", "mock");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
  vi.stubEnv("DATABASE_URL", "");
  (globalThis as { __sentinelStore?: unknown }).__sentinelStore = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/agent/gemini");
});

describe("agent route (mock mode, scenario 5)", () => {
  it("streams meta, tool_call, tool_result, final, done", async () => {
    const ev = await ask("Can I kayak at Bartram's Garden tomorrow morning?");
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe("meta");
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("final");
    expect(types.at(-1)).toBe("done");
    const calls = ev.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name);
    expect(calls).toEqual(["get_rainfall", "get_river_conditions", "assess_spot"]);
    const f = finalOf(ev);
    expect(f.text).toMatch(/Bartram's Garden/);
    expect(f.text).toMatch(/\*\*Verdict:\*\*/);
    expect(f.text).toMatch(/tidal/i);
    expect(f.verdict?.spotId).toBe("bartrams-garden");
  });

  it("compares all spots for 'which spot' questions", async () => {
    const ev = await ask("Which spot is safest for fishing this weekend?");
    const assessed = ev.filter((e) => e.type === "tool_call" && e.name === "assess_spot");
    expect(assessed).toHaveLength(6);
    expect(finalOf(ev).text).toMatch(/best bet/);
  });

  it("declines swimming (scenario 10)", async () => {
    const ev = await ask("Can I swim at Boathouse Row?");
    const f = finalOf(ev);
    expect(f.text).toMatch(/can't recommend swimming/i);
    expect(f.text).toMatch(/No swimming/);
  });

  it("says avoid during the demo storm (scenario 2)", async () => {
    const ev = await ask("Can I kayak at Bartram's Garden right now?", true);
    const f = finalOf(ev);
    expect(f.verdict?.band).toBe("red");
    expect(f.text).toMatch(/Avoid/);
    expect(f.text).toMatch(/[Ss]ewage overflow/);
  });

  it("rejects an empty question", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("falls back to the offline agent when Gemini fails (quota)", async () => {
    vi.stubEnv("AGENT_MODE", "");
    vi.stubEnv("GEMINI_API_KEY", "fake");
    vi.doMock("@/lib/agent/gemini", async (orig) => ({
      ...(await orig<typeof import("@/lib/agent/gemini")>()),
      runGeminiAgent: async () => {
        throw new Error("429 RESOURCE_EXHAUSTED");
      },
    }));
    const ev = await ask("Is Boathouse Row safe for rowing right now?");
    expect(ev.find((e) => e.type === "thought" && /quota/i.test(e.text))).toBeTruthy();
    expect(finalOf(ev).text).toMatch(/Boathouse Row/);
  });
});

describe("graceful degradation", () => {
  it("USGS and Open-Meteo down → cached fixtures with a timestamp (scenarios 3 & 4)", async () => {
    vi.stubEnv("FORCE_FIXTURES", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); }));
    const { getSnapshot, clearSnapshotCache } = await import("@/lib/conditions");
    clearSnapshotCache();
    const snap = await getSnapshot();
    expect(snap.sources.usgs.status).toBe("cached");
    expect(snap.sources.rain.status).toBe("cached");
    expect(snap.sources.usgs.error).toMatch(/ENOTFOUND/);
    expect(Date.parse(snap.sources.usgs.asOf)).toBeGreaterThan(0);
    expect(snap.assessments).toHaveLength(6);
    vi.unstubAllGlobals();
  });

  it("only Open-Meteo down → USGS live, rain cached", async () => {
    vi.stubEnv("FORCE_FIXTURES", "");
    const usgs = (await import("@/fixtures/usgs.json")).default;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("open-meteo")) return new Response("oops", { status: 503 });
        return Response.json(usgs);
      }),
    );
    const { getSnapshot, clearSnapshotCache } = await import("@/lib/conditions");
    clearSnapshotCache();
    const snap = await getSnapshot();
    expect(snap.sources.usgs.status).toBe("live");
    expect(snap.sources.rain.status).toBe("cached");
    expect(snap.sources.rain.error).toMatch(/503/);
    vi.unstubAllGlobals();
  });

  it("no DATABASE_URL → in-memory subscriptions and query history (scenario 6)", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@b.co", spotId: "penns-landing", threshold: "red" }) }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, storage: "memory" });
    const bad = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "nope", spotId: "penns-landing" }) }));
    expect(bad.status).toBe(400);

    await ask("Is Boathouse Row safe for rowing right now?");
    await new Promise((r) => setTimeout(r, 10));
    const { GET } = await import("@/app/api/history/route");
    const hist = await (await GET(new Request("http://x/api/history"))).json();
    expect(hist.storage).toBe("memory");
    expect(hist.subscriptions).toBe(1);
    expect(hist.queries[0].question).toMatch(/Boathouse/);
  });

  it("no ELEVENLABS_API_KEY → TTS returns 204 so the browser falls back (scenario 6b)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { POST } = await import("@/app/api/tts/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ text: "hello" }) }));
    expect(res.status).toBe(204);
  });
});

describe("time parsing", () => {
  it("understands tomorrow morning / weekend in Philly time", async () => {
    const { parseWhen, fmtNY, isoNY } = await import("@/lib/time");
    const sat5pm = Date.parse("2026-09-26T21:00:00Z"); // Sat 5 PM EDT
    const t = parseWhen("Can I kayak tomorrow morning?", sat5pm);
    expect(fmtNY(t.t, { weekday: "short", hour: "numeric" })).toBe("Sun 8 AM");
    expect(parseWhen("this weekend", sat5pm).t).toBe(sat5pm);
    expect(parseWhen("right now", sat5pm).label).toBe("right now");
    expect(isoNY(Date.parse("2026-09-27T12:00:00Z"))).toBe("2026-09-27T08:00:00-04:00");
    expect(parseWhen("2025-09-27T08:00:00-04:00", sat5pm).label).toMatch(/in the past/);
    const wed = Date.parse("2026-09-23T14:00:00Z");
    expect(fmtNY(parseWhen("this weekend", wed).t, { weekday: "short" })).toBe("Sat");
  });
});
