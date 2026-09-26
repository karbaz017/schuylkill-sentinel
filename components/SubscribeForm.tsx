"use client";

import { useState } from "react";
import { SPOTS } from "@/data/spots";

export default function SubscribeForm({ defaultSpot, onToast }: { defaultSpot?: string; onToast: (msg: string, kind?: "ok" | "err") => void }) {
  const [email, setEmail] = useState("");
  const [spotId, setSpotId] = useState(defaultSpot ?? SPOTS[0].id);
  const [threshold, setThreshold] = useState<"red" | "yellow">("red");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, spotId, threshold }),
      });
      const body = await r.json();
      if (!body.ok) throw new Error(body.error ?? "Something went wrong");
      onToast(`🔔 ${body.message}`, "ok");
      setEmail("");
    } catch (err) {
      onToast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel p-4 sm:p-5" aria-label="Subscribe to alerts">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Get a heads-up</h2>
        <span className="text-[11px] text-faint">Email me when my spot turns risky</span>
      </div>
      <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto]">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="col-span-2 min-w-0 rounded-xl border border-line bg-black/30 px-3 py-2 text-sm placeholder:text-faint sm:col-span-1 focus:border-accent/60 focus:outline-none"
          aria-label="Email"
        />
        <select
          value={spotId}
          onChange={(e) => setSpotId(e.target.value)}
          className="col-span-2 min-w-0 rounded-xl border border-line bg-black/30 px-2.5 py-2 text-sm focus:border-accent/60 focus:outline-none sm:col-span-1"
          aria-label="Spot"
        >
          {SPOTS.map((s) => (
            <option key={s.id} value={s.id} className="bg-[#0a1624]">
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={threshold}
          onChange={(e) => setThreshold(e.target.value as "red" | "yellow")}
          className="rounded-xl border border-line bg-black/30 px-2.5 py-2 text-sm focus:border-accent/60 focus:outline-none"
          aria-label="Alert threshold"
        >
          <option value="red" className="bg-[#0a1624]">at Red</option>
          <option value="yellow" className="bg-[#0a1624]">at Yellow+</option>
        </select>
        <button
          disabled={busy}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:bg-accent hover:text-[#03101a] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Subscribe"}
        </button>
      </div>
    </form>
  );
}
