export interface GaugeMeta {
  siteId: string;
  name: string;
  tidal: boolean;
  // Median daily discharge (cfs) by month Jan..Dec, averaged from USGS daily p50 statistics.
  monthlyMedianCfs?: number[];
}

export const GAUGES: Record<string, GaugeMeta> = {
  "01474500": {
    siteId: "01474500",
    name: "Schuylkill River at Philadelphia (Fairmount Dam)",
    tidal: false,
    monthlyMedianCfs: [2328, 2742, 3719, 3256, 2278, 1560, 1081, 898, 777, 952, 1471, 2123],
  },
  "01473500": {
    siteId: "01473500",
    name: "Schuylkill River at Norristown",
    tidal: false,
    monthlyMedianCfs: [2286, 2450, 3216, 2973, 2386, 1738, 1358, 1009, 889, 1346, 1623, 2482],
  },
  "01463500": {
    siteId: "01463500",
    name: "Delaware River at Trenton NJ",
    tidal: false,
    monthlyMedianCfs: [9809, 10074, 16087, 18383, 11664, 7138, 5109, 4496, 4014, 4621, 7915, 9912],
  },
  "01467200": {
    siteId: "01467200",
    name: "Delaware River at Penn's Landing",
    tidal: true, // discharge here is tidal flow, gage swings ~6 ft twice a day
  },
};

export const GAUGE_IDS = Object.keys(GAUGES);
