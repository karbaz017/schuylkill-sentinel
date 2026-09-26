"use client";

import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRow } from "@/lib/types";

const fmtHour = (t: number) =>
  new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" });

export default function MiniChart({ rows, now, tidal }: { rows: ChartRow[]; now: number; tidal?: boolean }) {
  if (!rows.length) return <div className="grid h-[132px] place-items-center text-xs text-faint">No chart data</div>;
  const maxRain = Math.max(0.1, ...rows.map((r) => r.rainIn));
  const hasGage = rows.some((r) => r.gageFt != null);
  return (
    <div className="h-[132px] w-full" aria-label="72-hour rainfall and river gauge chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 0, bottom: 0, left: -18 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" })}
            ticks={rows.filter((r) => new Date(r.t).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }) === "12").map((r) => r.t)}
            tick={{ fill: "var(--faint)", fontSize: 10 }}
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
          />
          <YAxis yAxisId="rain" domain={[0, maxRain * 1.3]} tick={{ fill: "var(--faint)", fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}″`} axisLine={false} tickLine={false} width={44} />
          <YAxis yAxisId="gage" orientation="right" hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
          <ReferenceLine yAxisId="rain" x={now} stroke="var(--accent)" strokeDasharray="3 3" label={{ value: "now", fill: "var(--accent)", fontSize: 10, position: "insideTopRight" }} />
          <Bar yAxisId="rain" dataKey="rainIn" barSize={3} radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.t} fill={r.forecast ? "rgba(56,189,248,0.35)" : "var(--accent-2)"} />
            ))}
          </Bar>
          {hasGage && (
            <Line yAxisId="gage" type="monotone" dataKey="gageFt" stroke="var(--accent)" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          )}
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            contentStyle={{ background: "#0a1624", border: "1px solid var(--line)", borderRadius: 10, fontSize: 11 }}
            labelFormatter={(t) => fmtHour(Number(t))}
            formatter={(v, name) =>
              name === "rainIn" ? [`${Number(v).toFixed(2)} in`, "Rain"] : [`${Number(v).toFixed(2)} ft`, tidal ? "Gauge (tidal)" : "Gauge"]
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
