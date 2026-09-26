import { describe, expect, it } from "vitest";

// Runs only against a real database: TEST_DATABASE_URL=postgres://... npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres / Tiger Data store", () => {
  it("creates the schema, writes readings, and reads hourly rollups", async () => {
    process.env.DATABASE_URL = url;
    (globalThis as { __sentinelStore?: unknown }).__sentinelStore = undefined;
    const { getStore, recordReadings } = await import("@/lib/db");
    const store = await getStore();
    expect(["timescale", "postgres"]).toContain(store.kind);

    const now = Date.now();
    const H = 3600_000;
    const series = Array.from({ length: 12 }, (_, i) => ({ t: Math.floor((now - (11 - i) * 15 * 60_000) / 60_000) * 60_000, v: 6 + i * 0.01 }));
    await recordReadings({ T1: { siteId: "TEST-1", siteName: "t", series: { gageFt: series } } }, [{ t: Math.floor(now / H) * H, mm: 2.5 }]);
    await recordReadings({ T1: { siteId: "TEST-1", siteName: "t", series: { gageFt: series } } }, []); // idempotent re-insert

    const rows = await store.hourly("TEST-1", "gageFt", 6);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.reduce((n, r) => n + r.samples, 0)).toBe(12);

    await store.insertQuery({ createdAt: new Date().toISOString(), question: "db test?", mode: "mock", trace: [{ type: "done", ms: 1 }] });
    expect((await store.recentQueries(1))[0].question).toBe("db test?");
    const sub = await store.upsertSubscription({ email: "t@example.com", spotId: "penns-landing", threshold: "red", createdAt: "" });
    expect(sub.id).toBeGreaterThan(0);
    expect((await store.stats()).readings).toBeGreaterThanOrEqual(12);
  });
});
