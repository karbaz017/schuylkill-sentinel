"use client";

import { useEffect, useRef, useState } from "react";

/** Plays text through ElevenLabs (/api/tts); falls back to the browser's speechSynthesis. */
export default function ReadAloud({ text, className = "" }: { text: string; className?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [engine, setEngine] = useState<"elevenlabs" | "browser" | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  const stop = () => {
    audio.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setState("idle");
  };

  useEffect(
    () => () => {
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  // New answer → drop the cached audio.
  useEffect(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, [text]);

  const spoken = text
    .replace(/\*\*Verdict:\*\*/i, "Verdict:")
    .replace(/[*_`#]/g, "")
    .replace(/(\d+)\/100/g, "$1 out of 100")
    .replace(/(\d)″/g, "$1 inches")
    .replace(/\n+/g, ". ")
    .replace(/\.\s*\./g, ".");

  const browserSpeak = () => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setState("idle");
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(spoken);
    u.rate = 1.02;
    const v = synth.getVoices().find((x) => /en-US/.test(x.lang) && /Samantha|Google|Natural|Aria|Jenny/.test(x.name));
    if (v) u.voice = v;
    u.onend = u.onerror = () => setState("idle");
    setEngine("browser");
    setState("playing");
    synth.speak(u);
  };

  const play = async () => {
    if (state !== "idle") return stop();
    setState("loading");
    try {
      if (!url.current) {
        const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spoken }) });
        if (r.status !== 200) return browserSpeak();
        url.current = URL.createObjectURL(await r.blob());
      }
      const el = (audio.current ??= new Audio());
      el.src = url.current;
      el.onended = () => setState("idle");
      setEngine("elevenlabs");
      setState("playing");
      await el.play();
    } catch {
      browserSpeak();
    }
  };

  return (
    <button
      onClick={play}
      className={`group inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent/50 hover:bg-accent/10 ${className}`}
      aria-label={state === "playing" ? "Stop reading" : "Read the verdict aloud"}
    >
      {state === "loading" ? (
        <span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent" />
      ) : state === "playing" ? (
        <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className="w-[3px] rounded-sm bg-accent" style={{ height: "100%", animation: `eq .${6 + i}s ease-in-out ${i * 0.1}s infinite alternate` }} />
          ))}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-accent" aria-hidden>
          <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
        </svg>
      )}
      {state === "playing" ? "Stop" : "Read aloud"}
      {engine && <span className="text-[10px] text-faint">{engine === "elevenlabs" ? "ElevenLabs" : "browser voice"}</span>}
      <style>{`@keyframes eq{from{transform:scaleY(.25)}to{transform:scaleY(1)}} .group i{transform-origin:bottom}`}</style>
    </button>
  );
}
