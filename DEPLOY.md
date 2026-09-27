# Deploying Schuylkill Sentinel

The app is one Next.js server. It works with **zero** env vars: it uses the offline agent, the in-memory store, and the browser voice. Add keys to light up each sponsor integration.

| Variable | Needed for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Gemini agent | Easiest for servers. Get one at https://aistudio.google.com/apikey |
| `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION=global` | Gemini via Vertex AI | Only where ADC exists (your laptop, a GCE VM). Gemini 3.x flash models are served from `global`. |
| `DATABASE_URL` | Tiger Data | The Tiger Cloud connection string (`postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:3xxxx/tsdb?sslmode=require`). The schema is created automatically on first request. |
| `ELEVENLABS_API_KEY` | Read-aloud voice | Optional `ELEVENLABS_VOICE_ID` |
| `NEXT_PUBLIC_SITE_URL` | OG image URLs | e.g. `https://schuylkillsentinel.tech` |

## 1. Tiger Data (do this first, 3 min)

1. Sign in at https://console.cloud.timescale.com and create a service (free trial tier is fine, region `us-east-1`).
2. Copy the connection string and use it as `DATABASE_URL`.
3. Start the app and load the page once. The `readings` hypertable, the `readings_hourly` continuous aggregate, the compression policy, and the `queries` and `subscriptions` tables are all created from `db/schema.sql`. The header badge should say **Tiger Data**.
4. Check it: `psql "$DATABASE_URL" -c "select * from timescaledb_information.continuous_aggregates;"`

## 2. Vultr (primary)

### Option A: Cloud Compute + Docker (simplest, ~10 min)

1. In the Vultr portal: **Deploy → Shared CPU → `vc2-1c-2gb`** (1 vCPU / 2 GB), **New York (NJ)**, **Ubuntu 24.04 LTS x64**, **Public IPv4** (not an IPv6-only plan, because GitHub has no IPv6), backups off, your SSH key ticked.
2. From your laptop, copy your env file up (it stays off GitHub):
   ```bash
   scp .env root@<VULTR_IP>:/root/sentinel.env
   ```
   > **Gemini on a server needs `GEMINI_API_KEY`** (ideally a billed key; the free tier hits 429 after a few questions). `GOOGLE_CLOUD_PROJECT` alone only works where Google ADC exists (your laptop). Without a key the app still runs, using the offline agent, and `/?replay=1` still shows the recorded Gemini runs.
3. SSH in and run:
   ```bash
   ssh root@<VULTR_IP>
   # 2 GB swap so the Next.js build never runs out of memory
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   # Vultr's Ubuntu image enables ufw with only SSH open
   ufw allow 80/tcp && ufw allow 443/tcp
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/karbaz017/schuylkill-sentinel.git && cd schuylkill-sentinel
   docker build -t sentinel --build-arg NEXT_PUBLIC_SITE_URL=http://<VULTR_IP> .
   docker run -d --name sentinel --restart unless-stopped --env-file /root/sentinel.env -p 80:3000 sentinel
   ```
   The site is now at **http://\<VULTR_IP\>** (and `http://<VULTR_IP>/?replay=1`).
4. **Add HTTPS once your domain's A record points at the server.** Move the app off port 80 and put Caddy in front, which gets a certificate automatically:
   ```bash
   docker rm -f sentinel
   docker build -t sentinel --build-arg NEXT_PUBLIC_SITE_URL=https://yourdomain.tech .
   docker run -d --name sentinel --restart unless-stopped --env-file /root/sentinel.env -p 127.0.0.1:3000:3000 sentinel
   docker run -d --name caddy --restart unless-stopped --network host \
     -v caddy_data:/data caddy:2 caddy reverse-proxy --from yourdomain.tech --to 127.0.0.1:3000
   ```
5. To update: `cd schuylkill-sentinel && git pull`, then repeat the `docker build` and `docker rm -f sentinel && docker run …` lines.
6. Useful: `docker logs -f sentinel` (look for `[db]`/`[agent]` lines), `curl -s localhost/api/conditions | head -c 300`.

### Option B: Vultr Container Registry

1. Portal: **Products → Container Registry → Add**, name it `sentinel` (e.g. region `ewr`). Copy the registry URL and credentials.
2. From your laptop (on Apple Silicon, build for amd64):
   ```bash
   docker login https://ewr.vultrcr.com/sentinel -u <user> -p <api-key>
   docker build --platform linux/amd64 -t ewr.vultrcr.com/sentinel/app:latest .
   docker push ewr.vultrcr.com/sentinel/app:latest
   ```
3. On the Vultr instance: `docker login …` then `docker run -d --restart unless-stopped --env-file .env -p 3000:3000 ewr.vultrcr.com/sentinel/app:latest`, and add Caddy as in Option A.

### Domain (GoDaddy Registry)

Register the domain, then add an **A record** for `@` (and `www`) pointing at the Vultr instance IP. Set `NEXT_PUBLIC_SITE_URL=https://<domain>` and restart the container.

## 3. Vercel (fallback, ~3 min)

1. https://vercel.com/new → import `karbaz017/schuylkill-sentinel`. The framework is auto-detected as Next.js.
2. Add env vars: `GEMINI_API_KEY` (Vertex ADC isn't available on Vercel), `DATABASE_URL`, `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_SITE_URL`.
3. Deploy. The agent route sets `maxDuration = 60`. On the Hobby plan this works with Fluid compute (the default for new projects).

## Pre-demo checklist

- [ ] Load the site on your phone. The badges should read USGS live, Open-Meteo live, Gemini agent, Tiger Data, ElevenLabs voice.
- [ ] Ask one suggested question, so Gemini is warm and a trace is stored.
- [ ] Flip **Demo: storm** and confirm the markers go red.
- [ ] If venue Wi-Fi dies: `FORCE_FIXTURES=1` isn't needed, because failed fetches fall back automatically and a yellow banner shows the cache time.
