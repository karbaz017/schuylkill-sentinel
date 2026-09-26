import { describe, expect, it } from "vitest";
import usgsFixture from "@/fixtures/usgs.json";
import rainFixture from "@/fixtures/rain.json";
import meta from "@/fixtures/meta.json";
import { SPOTS, getSpot } from "@/data/spots";
import { assessSpot, bandFor, csoFactor, THRESHOLDS, verdictFor } from "@/lib/risk";
import { parseUsgs, type UsgsResponse } from "@/lib/usgs";
import { parseRain, type OpenMeteoResponse } from "@/lib/rain";
import { applyStorm } from "@/lib/scenario";
import type { GaugeData, Point, RainPoint } from "@/lib/types";

const H = 3600_000;
const NOW = Date.parse("2026-06-15T16:00:00Z"); // June: Fairmount median 1560 cfs
const spot = getSpot("boathouse-row")!;

/** Build an hourly rain series over [-72h, +24h] with rain amounts (in) at given hours-ago. */
function rainSeries(events: Record<number, number>, forecast: Record<number, number> = {}): RainPoint[] {
  const pts: RainPoint[] = [];
  for (let h = -72; h <= 24; h++) {
    const inches = h <= 0 ? events[-h] ?? 0 : forecast[h] ?? 0;
    pts.push({ t: NOW + h * H, mm: inches * 25.4 });
  }
  return pts;
}

function flat(v: number, hours = 72): Point[] {
  return Array.from({ length: hours + 1 }, (_, i) => ({ t: NOW - (hours - i) * H, v }));
}

function gauge(overrides: Partial<GaugeData["series"]> = {}): Record<string, GaugeData> {
  return {
    "01474500": {
      siteId: "01474500",
      siteName: "test",
      series: {
        gageFt: flat(6),
        dischargeCfs: flat(1500),
        waterTempC: flat(20),
        turbidityFnu: flat(5),
        dissolvedOxygen: flat(9),
        ...overrides,
      },
    },
  };
}

const run = (rain: RainPoint[], g = gauge(), s = spot, at?: number) => assessSpot({ spot: s, gauges: g, rain, now: NOW, at });
const factor = (a: ReturnType<typeof run>, f: string) => a.reasons.filter((r) => r.factor === f);

describe("bands", () => {
  it.each([
    [0, "green"],
    [33, "green"],
    [34, "yellow"],
    [66, "yellow"],
    [67, "red"],
    [100, "red"],
  ])("score %i → %s", (score, band) => expect(bandFor(score)).toBe(band));
});

describe("CSO factor", () => {
  it("dry week → 0 points and an explanatory reason", () => {
    const a = run(rainSeries({}));
    expect(a.score).toBe(0);
    expect(a.band).toBe("green");
    expect(factor(a, "cso")[0].text).toMatch(/unlikely/);
  });

  it("≥0.25 in in 24h → +20", () => {
    expect(run(rainSeries({ 3: 0.3 })).score).toBe(THRESHOLDS.csoLightPts);
  });

  it("≥0.5 in in 24h → +40", () => {
    const a = run(rainSeries({ 2: 0.3, 4: 0.3 }));
    expect(a.score).toBe(40);
    expect(factor(a, "cso")[0].text).toMatch(/overflow likely/);
  });

  it("just under the threshold → nothing", () => {
    expect(run(rainSeries({ 3: 0.24 })).score).toBe(0);
  });

  it("≥1.0 in in 48h adds +15 on top", () => {
    expect(run(rainSeries({ 2: 0.6, 30: 0.6 })).score).toBe(40 + 15);
  });

  it("holds full strength for 24h after rain stops", () => {
    expect(csoFactor(rainSeries({ 23: 0.6 }), NOW).points).toBe(40);
  });

  it("decays linearly between 24h and 48h", () => {
    expect(csoFactor(rainSeries({ 36: 0.6 }), NOW).points).toBe(20);
    expect(csoFactor(rainSeries({ 42: 0.6 }), NOW).points).toBe(10);
    const r = csoFactor(rainSeries({ 36: 0.6 }), NOW).reason!;
    expect(r.text).toMatch(/fading/);
  });

  it("is gone after 48h", () => {
    expect(csoFactor(rainSeries({ 49: 0.8 }), NOW).points).toBe(0);
  });
});

describe("CSO outfall exposure", () => {
  it("weights CSO points up near dense outfalls and down where there are few", () => {
    const rain = rainSeries({ 2: 0.6 });
    expect(run(rain, gauge(), getSpot("bartrams-garden")!).score).toBe(50);
    const g = { "01473500": gauge()["01474500"] };
    const a = run(rain, g, getSpot("manayunk-canal")!);
    expect(a.score).toBe(30);
    expect(a.reasons[0].text).toMatch(/weighted down/);
  });
});

describe("gauge factors", () => {
  it("turbidity >50 → +20, >100 → +30", () => {
    expect(run(rainSeries({}), gauge({ turbidityFnu: flat(60) })).score).toBe(20);
    expect(run(rainSeries({}), gauge({ turbidityFnu: flat(150) })).score).toBe(30);
  });

  it("missing turbidity is skipped with a reason (scenario 7)", () => {
    const g = gauge();
    delete g["01474500"].series.turbidityFnu;
    const a = run(rainSeries({}), g);
    expect(a.score).toBe(0);
    expect(factor(a, "turbidity")[0]).toMatchObject({ kind: "skipped" });
  });

  it("gage up >1 ft in 24h → +15", () => {
    const rising = flat(6).map((p) => ({ ...p, v: p.t > NOW - 24 * H ? 6 + ((p.t - (NOW - 24 * H)) / (24 * H)) * 1.5 : 6 }));
    const a = run(rainSeries({}), gauge({ gageFt: rising }));
    expect(a.score).toBe(15);
    expect(factor(a, "rise")[0].text).toMatch(/up 1.5 ft/);
  });

  it("discharge ≥3× monthly median → +10", () => {
    expect(run(rainSeries({}), gauge({ dischargeCfs: flat(1560 * 3.2) })).score).toBe(10);
    expect(run(rainSeries({}), gauge({ dischargeCfs: flat(1560 * 2) })).score).toBe(0);
  });

  it("cold water adds a warning, not points", () => {
    const a = run(rainSeries({}), gauge({ waterTempC: flat(7) }));
    expect(a.score).toBe(0);
    expect(factor(a, "cold")[0].kind).toBe("warning");
    expect(a.verdicts.find((v) => v.activity === "rowing")!.text).toMatch(/immersion/);
  });

  it("forecast >0.5 in flags worsening", () => {
    const a = run(rainSeries({}, { 6: 0.4, 8: 0.3 }));
    expect(a.worsening).toBe(true);
    expect(factor(a, "forecast")[0].text).toMatch(/worsen/);
  });

  it("score is capped at 100", () => {
    const a = run(rainSeries({ 2: 1, 20: 1 }), gauge({ turbidityFnu: flat(300), dischargeCfs: flat(99999), dissolvedOxygen: flat(3) }));
    expect(a.score).toBeLessThanOrEqual(100);
    expect(a.band).toBe("red");
  });
});

describe("future assessments", () => {
  it("uses forecast rain when assessing tomorrow", () => {
    const rain = rainSeries({}, { 10: 0.7 });
    expect(run(rain).score).toBe(0);
    const tomorrow = run(rain, gauge(), spot, NOW + 14 * H);
    expect(tomorrow.score).toBe(40);
    expect(factor(tomorrow, "projection")).toHaveLength(1);
  });
});

describe("tidal spots (scenario 8)", () => {
  it("adds a tide caveat and skips rise rate on tidal gauges", () => {
    const pl = getSpot("penns-landing")!;
    const g = { "01467200": { siteId: "01467200", siteName: "PL", series: { gageFt: flat(2), turbidityFnu: flat(6) } } };
    const a = run(rainSeries({}), g, pl);
    expect(factor(a, "tide")).toHaveLength(1);
    expect(factor(a, "rise")[0].kind).toBe("skipped");
  });

  it("Bartram's Garden is marked tidal", () => {
    const a = run(rainSeries({}), gauge(), getSpot("bartrams-garden")!);
    expect(factor(a, "tide")[0].text).toMatch(/approximate/);
  });
});

describe("activity verdicts", () => {
  it("never recommends swimming, even at score 0 (scenario 10)", () => {
    expect(verdictFor("swimming", 0).status).toBe("no-go");
  });

  it("tolerances differ by activity", () => {
    expect(verdictFor("rowing", 30).status).toBe("go");
    expect(verdictFor("wading", 30).status).toBe("caution");
    expect(verdictFor("kayaking", 70).status).toBe("no-go");
    expect(verdictFor("shore", 70).status).toBe("caution");
    expect(verdictFor("fishing", 50).text).toMatch(/Don't eat/);
  });
});

describe("real fixtures", () => {
  const gauges = parseUsgs(usgsFixture as unknown as UsgsResponse);
  const rain = parseRain(rainFixture as OpenMeteoResponse);
  const now = Date.parse(meta.fetchedAt);

  it("normal day (scenario 1): every spot scores, nothing red", () => {
    const all = SPOTS.map((s) => assessSpot({ spot: s, gauges, rain, now }));
    expect(all).toHaveLength(6);
    for (const a of all) {
      expect(a.band).not.toBe("red");
      expect(a.reasons.length).toBeGreaterThan(0);
    }
  });

  it("storm scenario (scenario 2): red markers with a CSO reason", () => {
    const wall = Date.now();
    const storm = applyStorm(gauges, rain, now, wall);
    const all = SPOTS.map((s) => assessSpot({ spot: s, gauges: storm.gauges, rain: storm.rain, now: wall }));
    const red = all.filter((a) => a.band === "red");
    expect(red.length).toBeGreaterThanOrEqual(4);
    expect(all.find((a) => a.spotId === "tacony-pennypack")!.band).toBe("yellow"); // big Delaware dilutes
    for (const a of all) expect(a.reasons.some((r) => r.factor === "cso" && r.points > 0)).toBe(true);
    const bartram = all.find((a) => a.spotId === "bartrams-garden")!;
    expect(bartram.verdicts.find((v) => v.activity === "kayaking")!.status).toBe("no-go");
  });
});
