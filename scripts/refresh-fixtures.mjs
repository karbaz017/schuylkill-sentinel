// Re-captures real USGS + Open-Meteo responses into fixtures/ for offline demos.
// Usage: npm run fixtures:refresh   (the storm demo scenario is derived from these)
import { writeFileSync } from "node:fs";

const USGS = "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01474500,01473500,01463500,01467200&parameterCd=00065,00060,00010,63680,00300&siteStatus=all&period=P3D";
const RAIN = "https://api.open-meteo.com/v1/forecast?latitude=39.97&longitude=-75.18&hourly=precipitation&past_days=3&forecast_days=2&timezone=America%2FNew_York";

for (const [file, url] of [["fixtures/usgs.json", USGS], ["fixtures/rain.json", RAIN]]) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  writeFileSync(file, JSON.stringify(await r.json()));
  console.log("wrote", file);
}
writeFileSync("fixtures/meta.json", JSON.stringify({ fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") }) + "\n");
console.log("wrote fixtures/meta.json");
