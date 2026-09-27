# Progress

_Last updated: Sat Sep 26, 2026 (evening)_

## Done
1. ✅ Data fetchers (USGS IV, Open-Meteo), real fixtures in `fixtures/`, transparent risk model, 48 unit + integration tests
2. ✅ Leaflet map with colored markers, spot cards (verdicts, reasons, 72h rain + gauge chart), spot strip for mobile
3. ✅ Gemini agent (gemini-3.8-flash via API key or Vertex `global`; 3.5-flash fallback) with function calling and a streamed NDJSON trace; offline fallback agent
4. ✅ Tiger Data schema (hypertable, continuous aggregate + refresh policy, compression, queries, subscriptions); in-memory fallback; chart reads from the aggregate when a DB is attached
5. ✅ ElevenLabs read-aloud (`/api/tts`) with speechSynthesis fallback
6. ✅ Demo mode (storm scenario), cached-data banner, loading skeletons, animations, favicon, OG image
7. ✅ Dockerfile (standalone) + DEPLOY.md (Vultr Compute / Container Registry, Vercel)
8. ✅ README, DEVPOST.md, PITCH.md
9. ✅ Offline replay mode (`?replay=1`): 7 recorded Gemini 3.8 runs + ElevenLabs audio on fixtures; 55s demo video + README GIF in `docs/demo/`

Verified against **Tiger Cloud**: `readings` hypertable (compression on), `readings_hourly` continuous aggregate (real-time), columnstore and refresh policies scheduled, ~7.2k readings ingested, chart served from the aggregate, agent traces stored in `queries`. **ElevenLabs** returns 128 kbps MP3 audio. **Gemini** via Vertex ADC and via API key (`gemini-3.8-flash`).

Also verified: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; standalone server runs with fixtures + Postgres; live Gemini on Vertex answers all 3 suggested prompts; 375px layout checked with Chrome device emulation.

**Deployed on Vultr:** http://140.82.7.192 (vc2-1c-2gb, New York, Ubuntu 24.04, Docker). Live USGS/rain, Tiger Data (chart from the aggregate), Gemini via API key, ElevenLabs, and `/?replay=1` all verified on the server.

## Known issues / not verified
- **The Gemini API key in `.env` is free tier**: it hit 429 (quota) after a few agent runs while recording. Live demos on that key can fall back to the offline agent mid-demo. Use Vertex (ADC) locally, or enable billing on the key before deploying.
- On a brand-new database the very first page load draws the chart from the in-app rollup, because the first ingest is still being written. Every load after that reads from `readings_hourly`.
- **Docker image not built locally** (no Docker daemon on the dev laptop). The standalone bundle it copies was run and works.
- The API key takes precedence over Vertex when both are set (`lib/agent/gemini.ts`).
- Brief listed gauge 01474000 for Manayunk; that's Wissahickon Creek. We use 01473500 (Schuylkill at Norristown).
- Alert delivery is mocked by design.
- The first three commits lack Arbaz's `Co-authored-by` trailer. Rewriting pushed history was blocked by the tool sandbox; the commands are in the final handoff notes.

## Next (if time)
- Register the domain, point its A record at 140.82.7.192, add Caddy for HTTPS (DEPLOY.md step 4)
- "Recent questions" list from `/api/history` in the agent panel
