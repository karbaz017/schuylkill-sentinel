import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import type { GaugeData, RainPoint } from "./types";
import { PHILLY } from "./rain";

export interface QueryRecord {
  id?: number;
  createdAt: string;
  question: string;
  mode: string;
  model?: string;
  answer?: string;
  trace: unknown[];
  latencyMs?: number;
}

export interface Subscription {
  id?: number;
  createdAt: string;
  email: string;
  spotId: string;
  threshold: "yellow" | "red";
}

export interface HourlyRow {
  bucket: string;
  siteId: string;
  parameter: string;
  avg: number;
  min: number;
  max: number;
  sum: number;
  samples: number;
}

export interface Store {
  kind: "timescale" | "postgres" | "memory";
  insertReadings(rows: { time: Date; siteId: string; parameter: string; value: number; source: string }[]): Promise<number>;
  hourly(siteId: string, parameter: string, hours: number): Promise<HourlyRow[]>;
  insertQuery(q: QueryRecord): Promise<void>;
  recentQueries(limit: number): Promise<QueryRecord[]>;
  upsertSubscription(s: Subscription): Promise<Subscription>;
  countSubscriptions(): Promise<number>;
  stats(): Promise<{ readings: number; oldest?: string; newest?: string }>;
}

export const RAIN_SITE = `openmeteo:${PHILLY.lat},${PHILLY.lng}`;

// ---------- in-memory fallback ----------
export function memoryStore(): Store {
  const readings = new Map<string, { time: Date; siteId: string; parameter: string; value: number }>();
  const queries: QueryRecord[] = [];
  const subs = new Map<string, Subscription>();
  return {
    kind: "memory",
    async insertReadings(rows) {
      for (const r of rows) readings.set(`${r.siteId}|${r.parameter}|${r.time.getTime()}`, r);
      return rows.length;
    },
    async hourly(siteId, parameter, hours) {
      const since = Date.now() - hours * 3600_000;
      const b = new Map<number, number[]>();
      for (const r of readings.values()) {
        if (r.siteId !== siteId || r.parameter !== parameter || r.time.getTime() < since) continue;
        const k = Math.floor(r.time.getTime() / 3600_000) * 3600_000;
        (b.get(k) ?? b.set(k, []).get(k)!).push(r.value);
      }
      return [...b.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([k, v]) => ({
          bucket: new Date(k).toISOString(),
          siteId,
          parameter,
          avg: v.reduce((a, c) => a + c, 0) / v.length,
          min: Math.min(...v),
          max: Math.max(...v),
          sum: v.reduce((a, c) => a + c, 0),
          samples: v.length,
        }));
    },
    async insertQuery(q) {
      queries.unshift({ ...q, id: queries.length + 1 });
      queries.length = Math.min(queries.length, 200);
    },
    async recentQueries(limit) {
      return queries.slice(0, limit);
    },
    async upsertSubscription(s) {
      const saved = { ...s, id: subs.get(`${s.email}|${s.spotId}`)?.id ?? subs.size + 1 };
      subs.set(`${s.email}|${s.spotId}`, saved);
      return saved;
    },
    async countSubscriptions() {
      return subs.size;
    },
    async stats() {
      const times = [...readings.values()].map((r) => r.time.getTime());
      return {
        readings: readings.size,
        oldest: times.length ? new Date(Math.min(...times)).toISOString() : undefined,
        newest: times.length ? new Date(Math.max(...times)).toISOString() : undefined,
      };
    },
  };
}

// ---------- Postgres / TimescaleDB ----------
async function postgresStore(url: string): Promise<Store> {
  const sql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 8,
    onnotice: () => {},
    ssl: /sslmode=require|tsdb\.cloud|timescale/.test(url) ? "require" : undefined,
  });
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const statements = readFileSync(schemaPath, "utf8")
    .split(/^-- ;;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim());
  let timescale = true;
  for (const stmt of statements) {
    const tsOnly = /timescaledb|create_hypertable|add_compression_policy|add_continuous_aggregate_policy/.test(stmt);
    if (tsOnly && !timescale) continue;
    try {
      await sql.unsafe(stmt);
    } catch (e) {
      const msg = (e as Error).message;
      if (stmt.startsWith("CREATE EXTENSION")) {
        timescale = false;
        console.warn("[db] TimescaleDB extension unavailable, falling back to plain Postgres:", msg);
      } else if (tsOnly || /already/.test(msg)) {
        console.warn("[db] skipped:", msg);
      } else throw e;
    }
  }
  // Plain-Postgres stand-in for the continuous aggregate so queries still work.
  if (!timescale)
    await sql.unsafe(`CREATE OR REPLACE VIEW readings_hourly AS
      SELECT date_trunc('hour', time) AS bucket, site_id, parameter, avg(value) AS avg_value,
        min(value) AS min_value, max(value) AS max_value, sum(value) AS sum_value, count(*) AS samples
      FROM readings GROUP BY 1, 2, 3`);

  let lastRefresh = 0;
  return {
    kind: timescale ? "timescale" : "postgres",
    async insertReadings(rows) {
      if (!rows.length) return 0;
      let n = 0;
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000).map((r) => ({
          time: r.time,
          site_id: r.siteId,
          parameter: r.parameter,
          value: r.value,
          source: r.source,
        }));
        const res = await sql`
          INSERT INTO readings ${sql(chunk, "time", "site_id", "parameter", "value", "source")}
          ON CONFLICT (site_id, parameter, time) DO UPDATE SET value = EXCLUDED.value`;
        n += res.count;
      }
      // Backfilled rows land behind the aggregate's watermark; refresh at most every 10 min.
      if (timescale && Date.now() - lastRefresh > 10 * 60_000) {
        lastRefresh = Date.now();
        await sql`CALL refresh_continuous_aggregate('readings_hourly', now() - INTERVAL '4 days', now() - INTERVAL '1 hour')`.catch(
          (e) => console.warn("[db] refresh cagg:", e.message),
        );
      }
      return n;
    },
    async hourly(siteId, parameter, hours) {
      const rows = await sql`
        SELECT bucket, site_id, parameter, avg_value, min_value, max_value, sum_value, samples
        FROM readings_hourly
        WHERE site_id = ${siteId} AND parameter = ${parameter}
          AND bucket > now() - make_interval(hours => ${hours})
        ORDER BY bucket`;
      return rows.map((r) => ({
        bucket: new Date(r.bucket).toISOString(),
        siteId: r.site_id,
        parameter: r.parameter,
        avg: Number(r.avg_value),
        min: Number(r.min_value),
        max: Number(r.max_value),
        sum: Number(r.sum_value),
        samples: Number(r.samples),
      }));
    },
    async insertQuery(q) {
      await sql`INSERT INTO queries (question, mode, model, answer, trace, latency_ms)
        VALUES (${q.question}, ${q.mode}, ${q.model ?? null}, ${q.answer ?? null}, ${sql.json(q.trace as never)}, ${q.latencyMs ?? null})`;
    },
    async recentQueries(limit) {
      const rows = await sql`SELECT id, created_at, question, mode, model, answer, latency_ms FROM queries ORDER BY created_at DESC LIMIT ${limit}`;
      return rows.map((r) => ({
        id: Number(r.id),
        createdAt: new Date(r.created_at).toISOString(),
        question: r.question,
        mode: r.mode,
        model: r.model ?? undefined,
        answer: r.answer ?? undefined,
        trace: [],
        latencyMs: r.latency_ms ?? undefined,
      }));
    },
    async upsertSubscription(s) {
      const [r] = await sql`INSERT INTO subscriptions (email, spot_id, threshold) VALUES (${s.email}, ${s.spotId}, ${s.threshold})
        ON CONFLICT (email, spot_id) DO UPDATE SET threshold = EXCLUDED.threshold RETURNING id, created_at`;
      return { ...s, id: Number(r.id), createdAt: new Date(r.created_at).toISOString() };
    },
    async countSubscriptions() {
      const [r] = await sql`SELECT count(*)::int AS n FROM subscriptions`;
      return r.n;
    },
    async stats() {
      const [r] = await sql`SELECT count(*)::int AS n, min(time) AS oldest, max(time) AS newest FROM readings`;
      return {
        readings: r.n,
        oldest: r.oldest ? new Date(r.oldest).toISOString() : undefined,
        newest: r.newest ? new Date(r.newest).toISOString() : undefined,
      };
    },
  };
}

// ---------- singleton ----------
const g = globalThis as unknown as { __sentinelStore?: Promise<Store> };

export function getStore(): Promise<Store> {
  if (!g.__sentinelStore) {
    const url = process.env.DATABASE_URL;
    g.__sentinelStore = url
      ? postgresStore(url).catch((e) => {
          console.warn("[db] could not connect, using in-memory store:", e.message);
          return memoryStore();
        })
      : Promise.resolve(memoryStore());
  }
  return g.__sentinelStore;
}

/** Flatten gauge series + observed rain into rows and write them to the hypertable. */
export async function recordReadings(gauges: Record<string, GaugeData>, rain: RainPoint[]) {
  const store = await getStore();
  const rows: Parameters<Store["insertReadings"]>[0] = [];
  for (const gd of Object.values(gauges))
    for (const [param, series] of Object.entries(gd.series))
      for (const p of series ?? []) rows.push({ time: new Date(p.t), siteId: gd.siteId, parameter: param, value: p.v, source: "usgs" });
  for (const p of rain) rows.push({ time: new Date(p.t), siteId: RAIN_SITE, parameter: "precipMm", value: p.mm, source: "open-meteo" });
  return store.insertReadings(rows);
}
