import { ImageResponse } from "next/og";

export const alt = "Schuylkill Sentinel: live sewage-overflow and river-safety risk for Philly's waterfronts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const dots = [
  { x: 610, y: 250, c: "#34d399", s: "18" },
  { x: 700, y: 330, c: "#fbbf24", s: "47" },
  { x: 655, y: 400, c: "#fb7185", s: "82" },
  { x: 820, y: 360, c: "#34d399", s: "22" },
  { x: 850, y: 200, c: "#fbbf24", s: "40" },
  { x: 520, y: 150, c: "#34d399", s: "15" },
];

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #030811 0%, #07182a 60%, #0a2233 100%)", color: "#e7f2f8", fontFamily: "sans-serif", position: "relative" }}>
        {dots.map((d) => (
          <div key={d.s} style={{ position: "absolute", left: d.x + 250, top: d.y, width: 64, height: 64, borderRadius: 999, background: d.c, color: "#03101a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, boxShadow: `0 0 40px ${d.c}` }}>
            {d.s}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#0a1624", border: "2px solid #5eead4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>〰</div>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Schuylkill Sentinel</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
          <div style={{ fontSize: 42, fontWeight: 600, lineHeight: 1.15 }}>Is the river safe today?</div>
          <div style={{ fontSize: 26, color: "#8ea8bc", lineHeight: 1.35 }}>Live sewage-overflow and river-safety risk for Philly&apos;s waterfronts, with an AI agent that shows its reasoning.</div>
          <div style={{ fontSize: 20, color: "#5eead4", marginTop: 8 }}>USGS gauges · Open-Meteo · Gemini · Tiger Data · OwlHacks 2026</div>
        </div>
      </div>
    ),
    size,
  );
}
