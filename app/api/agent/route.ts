import { runAgent } from "@/lib/agent/run";
import type { AgentEvent } from "@/lib/agent/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Streams the agent's reasoning trace as newline-delimited JSON events. */
export async function POST(req: Request) {
  let body: { question?: string; demo?: boolean } = {};
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
        await runAgent(question, { demo: !!body.demo }, send);
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
