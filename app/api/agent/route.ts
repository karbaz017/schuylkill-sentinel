import { runAgent } from "@/lib/agent/run";
import { findReplay, playReplay } from "@/lib/agent/replay";
import type { AgentEvent } from "@/lib/agent/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Streams the agent's reasoning trace as newline-delimited JSON events. */
export async function POST(req: Request) {
  let body: { question?: string; demo?: boolean; replay?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const recorded = body.replay ? findReplay(question, !!body.demo) : undefined;
        // Replay mode: play a recorded run if we have one, otherwise the offline agent on fixtures.
        if (recorded) await playReplay(recorded, send, process.env.NODE_ENV === "test" ? 0 : 1);
        else await runAgent(question, { demo: !!body.demo, offline: !!body.replay }, send);
      } catch (e) {
        send({ type: "error", message: String((e as Error).message ?? e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
