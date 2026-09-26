import type { Band } from "@/lib/types";

export type AssessResult = { spotId: string; spotName: string; band: Band; score: number; label: string; activity?: string };

/** The answer badge: the spot's band, except swimming, which is always a red "No swimming". */
export function badgeFor(r: AssessResult) {
  if (r.activity === "swimming") return { spotId: r.spotId, spotName: r.spotName, band: "red" as Band, score: r.score, label: "No swimming" };
  return { spotId: r.spotId, spotName: r.spotName, band: r.band, score: r.score, label: r.label };
}
