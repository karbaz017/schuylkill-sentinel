// Records real agent runs (Gemini + tools + ElevenLabs audio) for offline replay mode.
//
// 1. npm run fixtures:refresh                      # fresh real data
// 2. FORCE_FIXTURES=1 npm run dev -- -p 3100       # server scores against exactly those fixtures
// 3. node scripts/record-replays.mjs http://localhost:3100
//
// Writes fixtures/replays.json and public/replay/*.mp3. Replay mode (?replay=1) serves the same
// fixtures, so the recorded answers match the numbers on the map.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const SCRIPT = [
  { id: "bartram-kayak-tomorrow", question: "Can I kayak at Bartram's Garden tomorrow morning?", demo: false },
  { id: "boathouse-rowing-now", question: "Is Boathouse Row safe for rowing right now?", demo: false },
  { id: "fishing-weekend", question: "Which spot is safest for fishing this weekend?", demo: false },
  { id: "swim-penns-landing", question: "Can I swim at Penn's Landing?", demo: false },
  { id: "storm-bartram-kayak", question: "Can I kayak at Bartram's Garden right now?", demo: true },
  { id: "storm-boathouse-rowing", question: "Is Boathouse Row safe for rowing right now?", demo: true },
  { id: "storm-fishing", question: "Which spot is safest for fishing this weekend?", demo: true },
];
const ATTEMPTS = 3;

async function record(q) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: q.question, demo: q.demo }),
  });
  if (!res.ok || !res.body) throw new Error(`agent HTTP ${res.status}`);
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) events.push({ ms: Math.round(performance.now() - t0), e: JSON.parse(l) });
  }
  return events;
}

const out = [];
let model = null;
mkdirSync("public/replay", { recursive: true });
for (const q of SCRIPT) {
  let best = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const events = await record(q);
    const meta = events.find((x) => x.e.type === "meta")?.e;
    const final = events.find((x) => x.e.type === "final")?.e;
    const thoughts = events.filter((x) => x.e.type === "thought").length;
    console.log(`${q.id} try ${i}: mode=${meta?.mode} model=${meta?.model} thoughts=${thoughts} final=${!!final}`);
    if (meta?.mode !== "gemini" || !final) continue;
    if (!best || thoughts > best.thoughts) best = { events, thoughts, final, meta };
    if (thoughts > 0) break;
  }
  if (!best) throw new Error(`No Gemini run recorded for ${q.id}. Is Gemini configured and FORCE_FIXTURES=1 set?`);
  model = best.meta.model;
  let audio;
  const tts = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: best.final.text }) });
  if (tts.status === 200) {
    writeFileSync(`public/replay/${q.id}.mp3`, Buffer.from(await tts.arrayBuffer()));
    audio = `/replay/${q.id}.mp3`;
  } else console.warn(`  no ElevenLabs audio for ${q.id} (HTTP ${tts.status}); replay will use the browser voice`);
  out.push({ id: q.id, question: q.question, demo: q.demo, audio, events: best.events });
}
writeFileSync("fixtures/replays.json", JSON.stringify({ recordedAt: new Date().toISOString(), model, replays: out }, null, 1) + "\n");
console.log(`wrote fixtures/replays.json (${out.length} replays)`);
