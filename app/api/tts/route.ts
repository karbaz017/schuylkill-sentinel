export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "George": a warm, clear narrator voice from the ElevenLabs premade library.
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

/** Text-to-speech via ElevenLabs. Returns 204 when unconfigured so the client falls back to speechSynthesis. */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response(null, { status: 204, headers: { "X-TTS": "unconfigured" } });
  const { text } = await req.json().catch(() => ({ text: "" }));
  const clean = String(text ?? "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  if (!clean) return Response.json({ error: "No text" }, { status: 400 });
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: clean, model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok || !r.body) {
      console.warn("[tts] ElevenLabs error", r.status, (await r.text().catch(() => "")).slice(0, 200));
      return new Response(null, { status: 204, headers: { "X-TTS": `error-${r.status}` } });
    }
    return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-TTS": "elevenlabs" } });
  } catch (e) {
    console.warn("[tts] ElevenLabs unreachable", (e as Error).message);
    return new Response(null, { status: 204, headers: { "X-TTS": "unreachable" } });
  }
}
