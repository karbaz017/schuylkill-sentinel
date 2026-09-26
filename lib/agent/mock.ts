import "server-only";
import { SPOTS, type Spot } from "@/data/spots";
import type { Activity, Band } from "@/lib/types";
import { parseWhen } from "@/lib/time";
import type { Emit } from "./events";
import { runTool, type ToolCtx } from "./tools";
import { badgeFor } from "./badge";

/**
 * Offline agent used when Gemini isn't configured or fails. It follows the same plan a
 * model would (rain → gauge → risk model) and calls the real tools against real (or cached)
 * data, so the trace and numbers are genuine; only the language is templated.
 */

const SPOT_WORDS: [RegExp, string][] = [
  [/bartram/i, "bartrams-garden"],
  [/boathouse|kelly/i, "boathouse-row"],
  [/walnut|schuylkill banks|banks/i, "schuylkill-banks"],
  [/manayunk/i, "manayunk-canal"],
  [/penn'?s landing|penns|landing/i, "penns-landing"],
  [/tacony|pennypack|palmyra/i, "tacony-pennypack"],
];

export function detectIntent(q: string) {
  const spotId = SPOT_WORDS.find(([re]) => re.test(q))?.[1];
  const activity: Activity | undefined = /swim/i.test(q)
    ? "swimming"
    : /kayak|paddl|canoe|sup\b/i.test(q)
      ? "kayaking"
      : /\brow(ing)?\b|scull|crew/i.test(q)
        ? "rowing"
        : /fish|angl/i.test(q)
          ? "fishing"
          : /dog|wad/i.test(q)
            ? "wading"
            : /walk|run|jog|bike|cycl/i.test(q)
              ? "shore"
              : undefined;
  const compare = !spotId || /which|safest|best|where|compare/i.test(q);
  const email = q.match(/[^\s@]+@[^\s@]+\.[^\s@.,]+/)?.[0];
  const subscribe = !!email && /alert|notify|subscribe|email me|let me know/i.test(q);
  return { spotId, activity, compare, email, subscribe };
}

let seq = 0;
async function call(emit: Emit, ctx: ToolCtx, name: string, args: Record<string, unknown>) {
  const id = `mock-${++seq}`;
  emit({ type: "tool_call", id, name, args });
  const t0 = Date.now();
  const out = await runTool(name, args, ctx);
  // A little pacing so the trace animates like a real agent.
  await new Promise((r) => setTimeout(r, process.env.NODE_ENV === "test" ? 0 : 250));
  emit({ type: "tool_result", id, name, ok: true, summary: out.summary, result: out.result, ms: Date.now() - t0 });
  return out.result as Record<string, unknown>;
}

const BAND_WORD: Record<Band, string> = { green: "Safe", yellow: "Caution", red: "Avoid" };

export async function runMockAgent(question: string, ctx: ToolCtx, emit: Emit, reason?: string) {
  const intent = detectIntent(question);
  const when = parseWhen(question, ctx.snap.now);
  const activity: Activity = intent.activity ?? (intent.spotId ? (SPOTS.find((s) => s.id === intent.spotId)!.uses.includes("rowing") ? "rowing" : "kayaking") : "kayaking");
  const whenArg = when.label === "right now" ? "now" : new Date(when.t).toISOString();

  emit({
    type: "thought",
    text:
      (reason ? `${reason} ` : "") +
      (activity === "swimming"
        ? "The user is asking about swimming. I won't recommend swimming in these rivers, but I'll check conditions so I can explain why."
        : intent.compare
          ? `Comparing every spot for ${activity} (${when.label}). Plan: check rainfall, list spots, then score each one with the risk model.`
          : `Plan: check recent rain (sewer-overflow trigger), read the nearest USGS gauge, then run the risk model for ${activity} ${when.label}.`),
  });

  const rain = await call(emit, ctx, "get_rainfall", { lat: 39.97, lng: -75.18 });

  if (intent.subscribe && intent.email && intent.spotId) {
    const r = await call(emit, ctx, "subscribe_alert", { email: intent.email, spotId: intent.spotId, threshold: /yellow|caution/i.test(question) ? "yellow" : "red" });
    const text = r.ok
      ? `Done: you're subscribed to alerts for **${r.spot}** when it reaches **${String(r.threshold).toUpperCase()}**. (Delivery is mocked in this demo.)\n\n**Verdict:** alert saved.`
      : `I couldn't subscribe you: ${r.error}\n\n**Verdict:** no alert saved.`;
    emit({ type: "final", text });
    return text;
  }

  let spots: Spot[];
  if (intent.compare) {
    await call(emit, ctx, "list_spots", {});
    spots = SPOTS;
  } else spots = [SPOTS.find((s) => s.id === intent.spotId)!];

  if (spots.length === 1) await call(emit, ctx, "get_river_conditions", { siteId: spots[0].gauge });

  const results: Record<string, unknown>[] = [];
  for (const s of spots) results.push(await call(emit, ctx, "assess_spot", { spotId: s.id, activity, when: whenArg }));

  const cached = ctx.snap.sources.usgs.status === "cached" || ctx.snap.sources.rain.status === "cached";
  const dataNote = cached ? "\n\n_Live feeds were unreachable, so this uses cached data._" : "";
  const r24 = Number(rain.last24h ?? 0);

  let text: string;
  let pick = results[0];
  if (activity === "swimming") {
    text =
      `I can't recommend swimming at ${pick.spotName}, or anywhere in the Schuylkill or Delaware in Philadelphia. ` +
      `Even on clear days there are strong currents, boat traffic, and bacteria from combined sewer overflows. ` +
      (pick.band === "green"
        ? `Sewage risk happens to be low right now (${pick.score}/100, ${r24.toFixed(2)} in of rain in 24h), but that's for boating, not swimming. `
        : `And right now sewage risk is elevated: **${pick.score}/100 (${pick.label})** after ${r24.toFixed(2)} in of rain in 24h. `) +
      `If you want to be on the water, a kayak or rowing shell on a green day is the safer way.\n\n**Verdict:** No swimming. Try a public pool or a guarded beach instead.`;
  } else {
    if (spots.length > 1) {
      results.sort((a, b) => Number(a.score) - Number(b.score));
      pick = results[0];
    }
    const reasons = (pick.reasons as string[]).filter((r) => /^\+|\[warning\]/.test(r)).slice(0, 3);
    const v = pick.activityVerdict as { status: string; text: string };
    const ranking =
      spots.length > 1
        ? "\n\n" + results.map((r, i) => `${i + 1}. ${r.spotName}: ${r.score}/100 ${r.label}`).join("\n")
        : "";
    const why = reasons.length
      ? reasons.map((r) => `- ${r.replace(/^\+\d+ \[\w+\] |\[\w+\] /, "")}`).join("\n")
      : `- Only ${r24.toFixed(2)} in of rain in the last 24h and the gauge is calm, so a sewage overflow is unlikely.`;
    const lead =
      spots.length > 1
        ? `**${pick.spotName}** is your best bet for ${activity} ${when.label}: **${pick.score}/100 (${pick.label})**.`
        : `**${pick.spotName}**, ${when.label}: **${pick.score}/100 (${pick.label})**.`;
    const tidal = SPOTS.find((s) => s.id === pick.spotId)?.tidal ? "\n\nIt's a tidal spot, so treat this as approximate." : "";
    const verdictLine =
      v.status === "go"
        ? `Go. ${cap(activity)} looks fine, but rinse off afterwards.`
        : v.status === "caution"
          ? `Caution. ${cap(activity)} is OK if you avoid contact with the water.`
          : `Avoid ${activity} for now. Wait 48h after heavy rain.`;
    text = `${lead}\n\n${why}${ranking}${tidal}${dataNote}\n\n**Verdict:** ${verdictLine}`;
  }

  emit({
    type: "final",
    text,
    verdict: badgeFor({
      spotId: String(pick.spotId),
      spotName: String(pick.spotName),
      band: pick.band as Band,
      score: Number(pick.score),
      label: BAND_WORD[pick.band as Band],
      activity,
    }),
  });
  return text;
}

const cap = (s: string) => (s === "shore" ? "Walking" : s[0].toUpperCase() + s.slice(1));
