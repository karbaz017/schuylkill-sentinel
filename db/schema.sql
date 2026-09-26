-- Schuylkill Sentinel schema for Tiger Data (TimescaleDB on Postgres).
-- Runs on startup; every statement is idempotent. Statements are separated by lines of "-- ;;"
-- so the app can run them one at a time and skip Timescale-only ones on plain Postgres.

CREATE EXTENSION IF NOT EXISTS timescaledb;
-- ;;

-- Every river gauge and rainfall sample we ever fetch. One row per (time, site, parameter).
CREATE TABLE IF NOT EXISTS readings (
  time       TIMESTAMPTZ      NOT NULL,
  site_id    TEXT             NOT NULL,  -- USGS site number, or 'openmeteo:<lat>,<lng>'
  parameter  TEXT             NOT NULL,  -- gageFt | dischargeCfs | waterTempC | turbidityFnu | dissolvedOxygen | precipMm
  value      DOUBLE PRECISION NOT NULL,
  source     TEXT             NOT NULL DEFAULT 'usgs'
);
-- ;;

-- Turn it into a hypertable partitioned by time (1-day chunks).
SELECT create_hypertable('readings', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE);
-- ;;

-- Unique key makes re-fetching the same 72h window idempotent (ON CONFLICT DO NOTHING/UPDATE).
CREATE UNIQUE INDEX IF NOT EXISTS readings_site_param_time ON readings (site_id, parameter, time DESC);
-- ;;

-- Compress chunks older than 7 days, segmented by series, since old data is read by series.
ALTER TABLE readings SET (timescaledb.compress, timescaledb.compress_segmentby = 'site_id, parameter', timescaledb.compress_orderby = 'time DESC');
-- ;;
SELECT add_compression_policy('readings', INTERVAL '7 days', if_not_exists => TRUE);
-- ;;

-- Continuous aggregate: hourly rollups power the 72h chart and the agent's history tool.
CREATE MATERIALIZED VIEW IF NOT EXISTS readings_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 hour', time) AS bucket,
  site_id,
  parameter,
  avg(value)  AS avg_value,
  min(value)  AS min_value,
  max(value)  AS max_value,
  sum(value)  AS sum_value,
  count(*)    AS samples
FROM readings
GROUP BY bucket, site_id, parameter
WITH NO DATA;
-- ;;

SELECT add_continuous_aggregate_policy('readings_hourly',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE);
-- ;;

-- Agent reasoning traces: the question, every tool call/result, and the final verdict.
CREATE TABLE IF NOT EXISTS queries (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  question   TEXT        NOT NULL,
  mode       TEXT        NOT NULL,   -- gemini | mock
  model      TEXT,
  answer     TEXT,
  trace      JSONB       NOT NULL,
  latency_ms INTEGER
);
-- ;;

-- Alert subscriptions (delivery is mocked for the hackathon).
CREATE TABLE IF NOT EXISTS subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email      TEXT        NOT NULL,
  spot_id    TEXT        NOT NULL,
  threshold  TEXT        NOT NULL,   -- yellow | red
  UNIQUE (email, spot_id)
);
