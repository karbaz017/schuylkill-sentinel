import { describe, expect, it } from "vitest";
import usgsFixture from "@/fixtures/usgs.json";
import rainFixture from "@/fixtures/rain.json";
import { latestTime, parseUsgs, type UsgsResponse } from "@/lib/usgs";
import { parseRain, rainTotals, sumBetween, type OpenMeteoResponse } from "@/lib/rain";

describe("USGS parser", () => {
  const gauges = parseUsgs(usgsFixture as unknown as UsgsResponse);

  it("finds all four gauges", () => {
    expect(Object.keys(gauges).sort()).toEqual(["01463500", "01467200", "01473500", "01474500"]);
  });

  it("decodes HTML entities in site names", () => {
    expect(gauges["01467200"].siteName).toBe("Delaware River at Penn's Landing, Philadelphia, PA");
  });

  it("picks the method block that has data (Penn's Landing publishes an empty block first)", () => {
    const pl = gauges["01467200"].series;
    for (const k of ["gageFt", "turbidityFnu", "waterTempC", "dissolvedOxygen"] as const) expect(pl[k]?.length, k).toBeGreaterThan(100);
  });

  it("parses all five parameters at Fairmount Dam, sorted ascending", () => {
    const s = gauges["01474500"].series;
    for (const k of ["gageFt", "dischargeCfs", "waterTempC", "turbidityFnu", "dissolvedOxygen"] as const) {
      expect(s[k]?.length, k).toBeGreaterThan(10);
      const pts = s[k]!;
      expect(pts[0].t).toBeLessThan(pts[pts.length - 1].t);
    }
  });

  it("drops noData sentinel values", () => {
    const json = {
      value: {
        timeSeries: [
          {
            sourceInfo: { siteName: "X", siteCode: [{ value: "1" }] },
            variable: { variableCode: [{ value: "63680" }], noDataValue: -999999 },
            values: [{ value: [{ value: "-999999", dateTime: "2026-01-01T00:00:00Z" }, { value: "4.2", dateTime: "2026-01-01T01:00:00Z" }] }],
          },
        ],
      },
    };
    expect(parseUsgs(json)["1"].series.turbidityFnu).toEqual([{ t: Date.parse("2026-01-01T01:00:00Z"), v: 4.2 }]);
  });

  it("handles an empty/garbage response without throwing", () => {
    expect(parseUsgs({} as UsgsResponse)).toEqual({});
    expect(latestTime({})).toBe(0);
  });
});

describe("Open-Meteo parser", () => {
  const rain = parseRain(rainFixture as OpenMeteoResponse);

  it("parses 120 hourly points and applies the UTC offset", () => {
    expect(rain).toHaveLength(120);
    // 2026-09-23T00:00 America/New_York (EDT, -4h) == 04:00Z
    expect(new Date(rain[0].t).toISOString()).toBe("2026-09-23T04:00:00.000Z");
  });

  it("computes rolling totals in inches", () => {
    const pts = [
      { t: 0, mm: 25.4 },
      { t: 3600_000, mm: 25.4 },
    ];
    expect(sumBetween(pts, -1, 3600_000)).toBeCloseTo(2);
    const totals = rainTotals(pts, 3600_000);
    expect(totals.last6h).toBe(2);
    expect(totals.next24h).toBe(0);
  });
});
