# Progress

_Last updated: Sat Sep 26, 2026 (evening)_

## Done
1. ✅ Data fetchers (USGS IV, Open-Meteo), real fixtures in `fixtures/`, transparent risk model, 48 unit + integration tests
2. ✅ Leaflet map with colored markers, spot cards (verdicts, reasons, 72h rain + gauge chart), spot strip for mobile
3. ✅ Gemini agent (gemini-3.5-flash via Vertex `global` or API key; 2.5-flash fallback) with function calling and a streamed NDJSON trace; offline fallback agent
4. ✅ Tiger Data schema (hypertable, continuous aggregate + refresh policy, compression, queries, subscriptions); in-memory fallback; chart reads from the aggregate when a DB is attached
5. ✅ ElevenLabs read-aloud (`/api/tts`) with speechSynthesis fallback
6. ✅ Demo mode (storm scenario), cached-data banner, loading skeletons, animations, favicon, OG image
7. ✅ Dockerfile (standalone) + DEPLOY.md (Vultr Compute / Container Registry, Vercel)
8. ✅ README, DEVPOST.md, PITCH.md

Verified against **Tiger Cloud**: `readings` hypertable (compression on), `readings_hourly` continuous aggregate (real-time), columnstore and refresh policies scheduled, ~7.2k readings ingested, chart served from the aggregate, agent traces stored in `queries`. **ElevenLabs** returns 128 kbps MP3 audio. **Gemini** via Vertex ADC (`gemini-3.5-flash`, `global`).

Also verified: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; standalone server runs with fixtures + Postgres; live Gemini on Vertex answers all 3 suggested prompts; 375px layout checked with Chrome device emulation.

## Known issues / not verified
- On a brand-new database the very first page load draws the chart from the in-app rollup, because the first ingest is still being written. Every load after that reads from `readings_hourly`.
- **Docker image not built locally** (no Docker daemon on the dev laptop). The standalone bundle it copies was run and works.
- The Gemini API-key path is untested (we use Vertex ADC locally). For Vultr/Vercel either add `GEMINI_API_KEY` or give the VM a service account.
- Brief listed gauge 01474000 for Manayunk; that's Wissahickon Creek. We use 01473500 (Schuylkill at Norristown).
- Alert delivery is mocked by design.
- The first three commits lack Arbaz's `Co-authored-by` trailer. Rewriting pushed history was blocked by the tool sandbox; the commands are in the final handoff notes.

## Next (if time)
- Deploy to Vultr, register the domain, set `NEXT_PUBLIC_SITE_URL`
- "Recent questions" list from `/api/history` in the agent panel
