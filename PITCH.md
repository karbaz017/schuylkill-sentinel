# Pitch: 4 minutes + Q&A

**Setup before you walk up:** laptop on the live site, logged in, full screen, zoom 110%. Demo toggle **off**. Ask one question beforehand so Gemini is warm. Phone in hand with the site open. Volume up for the voice.

**Roles (suggested):** Soundarya narrates, Arbaz drives the laptop. Swap for the tech section if you like.

---

## 0:00–0:30 · The problem (no clicks, look at the judges)

> "Temple's a mile from the Schuylkill. Every morning there are rowers at Boathouse Row, kayakers at Bartram's Garden, people fishing at Penn's Landing.
>
> Philadelphia's sewers are *combined*: storm water and sewage share one pipe. When it rains as little as a quarter inch, those pipes overflow into the river on purpose, through about 160 outfalls. That's raw sewage where people are paddling.
>
> The data to see it coming is public, but it's scattered across USGS pages built for hydrologists. We built **Schuylkill Sentinel** to answer one question: *is the water OK today?*"

## 0:30–2:30 · Live demo

1. **(Point at the header, 5s)** "Everything here is live: USGS river gauges, Open-Meteo rain, a Gemini agent, Tiger Data storing it, ElevenLabs for voice. Green dots mean live."
2. **(Point at the map, 10s)** "Six spots, each scored zero to a hundred. Today we're in the green: about four tenths of an inch of rain yesterday, clear water."
3. **Click the Bartram's Garden marker (15s).** "Every score explains itself. Here's the sewage-overflow factor, weighted up because a lot of outfalls drain near here. Turbidity's low, the river is steady, and it flags that it's tidal, so treat it as approximate. Verdicts differ by activity: kayaking's fine, dogs get a caution, swimming is always a no. Here's the 72-hour rain and gauge chart."
4. **Click the chip "Can I kayak at Bartram's Garden tomorrow morning?" (45s).** While it streams:
   > "This is Gemini with function calling. Watch the trace: it's thinking, it pulls the rainfall, then the Fairmount Dam gauge, then it runs *our* risk model for tomorrow at 8 AM using forecast rain. It doesn't guess numbers, it calls tools."
   When the answer lands: "Tomorrow is **Caution**, because the forecast pushes it over the overflow threshold. The map flew to the spot."
5. **Click "Read aloud" (10s).** Let the voice play one sentence, then click Stop. "ElevenLabs, for when you're on the dock with gloves on."
6. **Flip "Demo: storm" (25s).** "It hasn't poured today, so here's what a real summer thunderstorm looks like: 1.6 inches, ending 6 hours ago." Markers turn red. Click **Boathouse Row**: "Sewage overflow likely, turbidity near 150, the river up more than two feet. Avoid." Point at **Tacony**: "Still yellow. The Delaware is huge and dilutes it. The model knows the rivers behave differently."
7. **(Optional, 10s, only if on time)** Type: *"Can I swim at Penn's Landing?"* "It will never tell you to swim, even on a green day."

**Flip Demo off before the tech section.**

## 2:30–3:30 · How it works

> "Two design choices.
>
> **One: the model is transparent, not a black box.** Each factor adds points and a sentence: rain in a 24-hour window at the quarter-inch and half-inch overflow thresholds with a 48-hour decay, turbidity, rise rate, flow versus the monthly median from USGS statistics, and a weight per spot for how many outfalls drain nearby. Gemini doesn't decide safety. It calls the model and explains it. If Gemini is down, an offline agent runs the same tools on the same data.
>
> **Two: river data is a time series, so we store it as one.** Every reading goes into a Tiger Data hypertable, about seven thousand rows per fetch. A continuous aggregate rolls it up hourly, and that's what draws this chart. Compression keeps months of five-minute data cheap. That history is what lets us calibrate thresholds per spot next.
>
> And it runs on flaky Wi-Fi: every API has a real cached response, and a banner tells you when you're seeing cached data."

## 3:30–4:00 · What's next

> "Next we want to calibrate against ground truth, the city's overflow records and bacteria sampling, add NOAA tides, and send real alerts. About 700 US cities have combined sewers. The model only needs a gauge and a rain forecast.
>
> Schuylkill Sentinel: know before you go. Thank you!"

---

## Likely judge questions

**1. How accurate is the CSO estimate?**
It's a screening heuristic, not a bacteria test, and we say so in the app. The thresholds follow the Philadelphia Water Department's own framing: many outfalls start overflowing around a quarter to half inch of rain, and advisories typically last 24–48 hours. We add real river signals (turbidity, rise rate, flow versus the seasonal median) that respond to runoff. We haven't validated it against overflow logs yet. That's exactly why we store every reading: the next step is to fit per-spot thresholds against PWD's CSO event data and Enterococcus sampling, then measure precision and recall.

**2. Where does the data come from, and how fresh is it?**
Four USGS gauges: Fairmount Dam, Norristown, Penn's Landing, and Trenton. They report gage height, discharge, water temperature, turbidity, and dissolved oxygen every 5–15 minutes. Rain comes from Open-Meteo hourly, past 72h plus forecast. Seasonal normals come from USGS daily-median statistics. We cache for five minutes. We checked each gauge's real output first, which is how we caught that one site ID in our plan was a creek, and that Penn's Landing's data sits in a second sensor block.

**3. Why a time-series database instead of plain Postgres or just recomputing?**
Every question is about a window: rain in the last 24h, rise over 24h, hours since the storm. The hypertable partitions by time, so window queries only touch recent chunks. The continuous aggregate maintains hourly rollups incrementally instead of re-scanning raw data on every page load, and it serves the chart directly. Compression keeps history cheap, which matters because USGS only serves recent instantaneous data quickly. Building our own history is what enables calibration. It's still Postgres, so the agent traces and subscriptions live in the same database.

**4. What happens if the APIs, or Gemini, go down?**
Every fetch has an 8-second timeout. On failure we fall back to a real captured response and show a "cached data from <time>" banner. If Gemini is unconfigured, rate-limited, or unreachable, the agent falls back to an offline planner that calls the *same* tools on the same data, and the trace says why it switched. No database means an in-memory store; no ElevenLabs means the browser voice. Each of these has an automated test.

**5. How would this scale?**
The expensive part, fetching and scoring, is independent of users: one fetch per 5 minutes covers everyone, so page loads hit a cache. Scoring is pure and O(spots). Tiger Data handles ingest easily: even 1,000 gauges at 5-minute resolution is ~300k rows a day, which is small for a hypertable, with compression and retention policies. Agent calls are the per-user cost, and they're bounded to 8 steps. To add cities we add gauges and spots. The model is generic, but thresholds should be calibrated per system.

**6. Why rules instead of ML, and why is the LLM involved at all?**
Without labeled overflow data an ML model would just be guessing with more confidence. Rules are auditable, and every point has a reason a rower can read. The LLM doesn't decide safety. It turns a natural question ("tomorrow morning", "which spot", "my dog") into the right tool calls and explains the result. Next we'll learn the thresholds from the history we're collecting, and the explanation layer stays the same.

**Bonus: why is Tacony yellow in the storm demo?**
Tacony's upstream indicator is the Delaware at Trenton, which drains a huge watershed mostly outside a local storm, so it barely reacts. The sewage-rain factor still applies, but the river signals don't pile on.
