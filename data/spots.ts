import type { Activity } from "@/lib/types";

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  river: "Schuylkill" | "Delaware";
  tidal: boolean;
  gauge: string; // primary USGS site
  fallbackGauge?: string; // used for parameters the primary site doesn't report
  uses: string[];
  // How many combined-sewer outfalls drain near this spot (Philadelphia Water Dept. outfall maps, approximate).
  csoExposure: "high" | "moderate" | "low";
  activities: Activity[]; // activities we give verdicts for
  blurb: string;
}

export const SPOTS: Spot[] = [
  {
    id: "boathouse-row",
    name: "Boathouse Row / Kelly Drive",
    lat: 39.969,
    lng: -75.187,
    river: "Schuylkill",
    tidal: false,
    gauge: "01474500",
    uses: ["rowing", "running"],
    csoExposure: "moderate",
    activities: ["rowing", "kayaking", "wading", "swimming", "shore"],
    blurb: "Home of the Schuylkill Navy, above Fairmount Dam.",
  },
  {
    id: "schuylkill-banks",
    name: "Schuylkill Banks (Walnut St)",
    lat: 39.951,
    lng: -75.181,
    river: "Schuylkill",
    tidal: true,
    gauge: "01474500",
    uses: ["kayaking", "walking"],
    csoExposure: "high",
    activities: ["kayaking", "fishing", "wading", "swimming", "shore"],
    blurb: "Below Fairmount Dam, so the tide reaches here.",
  },
  {
    id: "bartrams-garden",
    name: "Bartram's Garden",
    lat: 39.931,
    lng: -75.212,
    river: "Schuylkill",
    tidal: true,
    gauge: "01474500",
    uses: ["kayaking", "fishing"],
    csoExposure: "high",
    activities: ["kayaking", "fishing", "wading", "swimming", "shore"],
    blurb: "Community boathouse on the tidal lower Schuylkill.",
  },
  {
    id: "manayunk-canal",
    name: "Manayunk Canal",
    lat: 40.024,
    lng: -75.222,
    river: "Schuylkill",
    tidal: false,
    gauge: "01473500",
    uses: ["kayaking", "cycling"],
    csoExposure: "low",
    activities: ["kayaking", "fishing", "wading", "swimming", "shore"],
    blurb: "Towpath paddling; nearest main-stem gauge is upstream at Norristown.",
  },
  {
    id: "penns-landing",
    name: "Penn's Landing",
    lat: 39.946,
    lng: -75.14,
    river: "Delaware",
    tidal: true,
    gauge: "01467200",
    fallbackGauge: "01463500",
    uses: ["fishing", "walking"],
    csoExposure: "high",
    activities: ["fishing", "kayaking", "wading", "swimming", "shore"],
    blurb: "Tidal Delaware waterfront with its own USGS turbidity sensor.",
  },
  {
    id: "tacony-pennypack",
    name: "Tacony-Palmyra / Pennypack",
    lat: 40.027,
    lng: -75.038,
    river: "Delaware",
    tidal: true,
    gauge: "01463500",
    fallbackGauge: "01467200",
    uses: ["fishing"],
    csoExposure: "moderate",
    activities: ["fishing", "kayaking", "wading", "swimming", "shore"],
    blurb: "Shore fishing near the Pennypack mouth; upstream indicator is Trenton.",
  },
];

export function getSpot(idOrName: string): Spot | undefined {
  const q = idOrName.trim().toLowerCase();
  return (
    SPOTS.find((s) => s.id === q) ??
    SPOTS.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.id.replace(/-/g, " ")))
  );
}
