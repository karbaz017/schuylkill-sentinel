import { NextResponse } from "next/server";
import { getSpot } from "@/data/spots";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const spot = getSpot(String(body.spotId ?? ""));
  const threshold = body.threshold === "yellow" ? "yellow" : "red";
  if (!EMAIL.test(email)) return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  if (!spot) return NextResponse.json({ ok: false, error: "Pick a spot." }, { status: 400 });
  const store = await getStore();
  const saved = await store.upsertSubscription({ email, spotId: spot.id, threshold, createdAt: new Date().toISOString() });
  return NextResponse.json({
    ok: true,
    id: saved.id,
    storage: store.kind,
    message: `You'll get an alert when ${spot.name} turns ${threshold === "red" ? "red" : "yellow or red"}.`,
  });
}
