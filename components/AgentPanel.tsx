"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/events";
import Markdown from "./Markdown";
import ReadAloud from "./ReadAloud";

const SUGGESTIONS = [
  "Can I kayak at Bartram's Garden tomorrow morning?",
  "Is Boathouse Row safe for rowing right now?",
  "Which spot is safest for fishing this weekend?",
];

type ToolStep = {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: Extract<AgentEvent, { type: "tool_result" }>;
};
type Step = { kind: "thought"; text: string } | ToolStep;

const TOOL_META: Record<string, { icon: string; label: string }> = {
  get_rainfall: { icon: "🌧", label: "Rainfall" },
  get_river_conditions: { icon: "〰", label: "USGS gauge" },
  assess_spot: { icon: "⚖", label: "Risk model" },
  list_spots: { icon: "📍", label: "Spots" },
  subscribe_alert: { icon: "🔔", label: "Alert" },
};

export default function AgentPanel({ demo, onVerdict, mode }: { demo: boolean; onVerdict: (spotId: string) => void; mode?: "gemini" | "mock" }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [final, setFinal] = useState<Extract<AgentEvent, { type: "final" }> | null>(null);
  const [meta, setMeta] = useState<Extract<AgentEvent, { type: "meta" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const traceEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (busy) traceEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [steps, final, busy]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setAsked(question);
    setQ("");
    setSteps([]);
    setFinal(null);
    setMeta(null);
    setError(null);
    setElapsed(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, demo }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AgentEvent);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("The agent couldn't be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handle(e: AgentEvent) {
    switch (e.type) {
      case "meta":
        setMeta(e);
        break;
      case "thought":
        setSteps((s) => [...s, { kind: "thought", text: e.text }]);
        break;
      case "tool_call":
        setSteps((s) => [...s, { kind: "tool", id: e.id, name: e.name, args: e.args }]);
        break;
      case "tool_result":
        setSteps((s) => s.map((x) => (x.kind === "tool" && x.id === e.id ? { ...x, result: e } : x)));
        break;
      case "final":
        setFinal(e);
        if (e.verdict) onVerdict(e.verdict.spotId);
        break;
      case "error":
        setError(e.message);
        break;
      case "done":
        setElapsed(e.ms);
        break;
    }
  }

  const toolCount = steps.filter((s) => s.kind === "tool").length;

  return (
    <section className="panel flex min-h-0 flex-col" aria-label="River safety agent">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="relative grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-accent-2/20 text-base ring-1 ring-accent/30">
            🦉
          </span>
          <div>
            <h2 className="font-display text-[15px] font-semibold leading-tight">Ask the Sentinel</h2>
            <p className="text-[11px] text-muted">
              {meta?.mode === "gemini" || (!meta && mode === "gemini")
                ? `Gemini agent${meta?.model ? ` · ${meta.model}` : ""} · function calling`
                : "Offline agent · same tools, templated answers"}
            </p>
          </div>
        </div>
        {asked && !busy && (
          <button
            onClick={() => {
              setAsked(null);
              setSteps([]);
              setFinal(null);
              setError(null);
            }}
            className="text-xs text-muted hover:text-ink"
          >
            Clear
          </button>
        )}
      </header>

      <form
        className="px-4 pt-4 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-black/30 p-1.5 pl-3.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Can I paddle at Penn's Landing tonight?"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
            aria-label="Ask about river conditions"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={busy || !q.trim()}
            className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-[#03101a] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
        <div className="scrollbar-thin -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="shrink-0 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent/50 hover:text-ink disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      <div className="scrollbar-thin min-h-[220px] flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-5 lg:max-h-[calc(100dvh-330px)]">
        {!asked && <EmptyState />}

        {asked && (
          <div className="rise-in mb-3 ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-2/15 px-3.5 py-2 text-sm text-ink ring-1 ring-accent-2/25">
            {asked}
          </div>
        )}

        {(steps.length > 0 || busy) && (
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
            Reasoning trace
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono normal-case tracking-normal">
              {toolCount} tool call{toolCount === 1 ? "" : "s"}
              {elapsed != null && ` · ${(elapsed / 1000).toFixed(1)}s`}
            </span>
          </div>
        )}

        <ol className="relative">
          {steps.map((s, i) => (
            <li key={i} className="rise-in relative pb-2.5 pl-7">
              <span className="absolute bottom-0 left-[9px] top-5 w-px bg-line" aria-hidden />
              {s.kind === "thought" ? <ThoughtStep text={s.text} /> : <ToolStepView step={s} />}
            </li>
          ))}
          {busy && !final && (
            <li className="relative pl-7 text-xs text-muted">
              <span className="absolute left-[3px] top-0.5 grid h-3.5 w-3.5 place-items-center">
                <span className="spin h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent" />
              </span>
              <span className="caret">{steps.length ? "Working" : "Reading the river"}</span>
            </li>
          )}
        </ol>

        {final && <FinalAnswer f={final} />}
        {error && (
          <div className="rise-in mt-3 rounded-xl border border-avoid/40 bg-avoid/10 px-3 py-2 text-sm text-avoid">{error}</div>
        )}
        <div ref={traceEnd} />
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center py-8 text-center">
      <svg viewBox="0 0 120 40" className="mb-3 h-10 w-28 opacity-70" aria-hidden>
        <path d="M0 20 Q15 8 30 20 T60 20 T90 20 T120 20" stroke="var(--accent)" strokeWidth="2" fill="none" />
        <path d="M0 30 Q15 18 30 30 T60 30 T90 30 T120 30" stroke="var(--accent-2)" strokeWidth="1.5" fill="none" opacity=".5" />
      </svg>
      <p className="max-w-[30ch] text-sm text-muted">
        Ask about a spot, an activity, and a time. You&apos;ll see every data pull and model step as the agent reasons.
      </p>
    </div>
  );
}

function ThoughtStep({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clean = text.replace(/^\*\*(.+?)\*\*\s*/, "");
  const title = text.match(/^\*\*(.+?)\*\*/)?.[1];
  const long = clean.length > 180;
  return (
    <>
      <span className="absolute left-0 top-0.5 grid h-[19px] w-[19px] place-items-center rounded-full bg-white/5 text-[10px] ring-1 ring-line" aria-hidden>
        💭
      </span>
      <div className="text-[13px] leading-relaxed text-muted">
        {title && <div className="text-xs font-semibold text-ink/80">{title}</div>}
        <p className={`italic ${!open && long ? "line-clamp-2" : ""}`}>{clean}</p>
        {long && (
          <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-accent/80 hover:text-accent">
            {open ? "less" : "more"}
          </button>
        )}
      </div>
    </>
  );
}

function ToolStepView({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[step.name] ?? { icon: "ƒ", label: step.name };
  const r = step.result;
  const args = Object.entries(step.args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return (
    <>
      <span
        className={`absolute left-0 top-1.5 grid h-[19px] w-[19px] place-items-center rounded-full text-[10px] ring-1 ${
          r ? (r.ok ? "bg-accent/15 ring-accent/40" : "bg-avoid/15 ring-avoid/40") : "bg-white/5 ring-line"
        }`}
        aria-hidden
      >
        {r ? meta.icon : <span className="spin h-2.5 w-2.5 rounded-full border-[1.5px] border-accent border-t-transparent" />}
      </span>
      <div className={`rounded-xl border bg-black/25 transition-colors ${r ? "border-line" : "border-accent/30"}`}>
        <button onClick={() => setOpen((o) => !o)} className="w-full px-3 py-2 text-left" aria-expanded={open}>
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-accent">{step.name}</span>
            <span className="min-w-0 flex-1 truncate text-faint">({args})</span>
            {r && <span className="shrink-0 text-[10px] text-faint">{r.ms}ms</span>}
            <span className={`shrink-0 text-[10px] text-faint transition ${open ? "rotate-90" : ""}`}>▸</span>
          </div>
          <div className="mt-0.5 text-[13px] text-ink/90">
            {r ? (
              <span className={r.ok ? "" : "text-avoid"}>
                <span className="mr-1.5 text-faint">→</span>
                {r.summary}
              </span>
            ) : (
              <span className="text-muted">calling {meta.label.toLowerCase()}…</span>
            )}
          </div>
        </button>
        {open && r && (
          <pre className="scrollbar-thin max-h-56 overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(r.result, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

function FinalAnswer({ f }: { f: Extract<AgentEvent, { type: "final" }> }) {
  const band = f.verdict?.band;
  const parts = f.text.split(/\n(?=\*\*Verdict:\*\*)/);
  const body = parts[0];
  const verdict = parts[1]?.replace(/^\*\*Verdict:\*\*\s*/, "");
  return (
    <div className={`rise-in mt-2 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-white/[0.05] to-transparent ${band ? `band-${band}` : ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: band ? "var(--band)" : "var(--accent)" }} />
          Answer
          {f.verdict && (
            <span className="rounded-full px-2 py-0.5 text-[10px] tracking-wider text-[#03101a]" style={{ background: "var(--band)" }}>
              {f.verdict.label} · {f.verdict.score}
            </span>
          )}
        </div>
        <ReadAloud text={f.text} />
      </div>
      <div className="px-4 py-3 text-[14px] leading-relaxed text-ink/90">
        <Markdown text={body} />
        {verdict && (
          <div className="mt-3 rounded-xl border-l-[3px] bg-white/[0.04] px-3 py-2 text-[14px] font-medium text-ink" style={{ borderColor: band ? "var(--band)" : "var(--accent)" }}>
            <span className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">Verdict</span>
            <Markdown text={verdict} className="inline" />
          </div>
        )}
      </div>
    </div>
  );
}
