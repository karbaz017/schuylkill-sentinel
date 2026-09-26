const TZ = "America/New_York";
const HOUR = 3600_000;

export function fmtNY(t: number | string, opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" }) {
  return new Date(t).toLocaleString("en-US", { timeZone: TZ, ...opts });
}

/** Offset of America/New_York from UTC at instant t, in ms (e.g. -4h in summer). */
function nyOffset(t: number): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(t))
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-4"
  const m = s.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? (Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0)) * 60_000 : 0;
}

function nyParts(t: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", weekday: "short", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, wd: p.weekday as string };
}

/** Instant for `hour`:00 local NY time, `dayOffset` days after the NY date of `now`. */
export function nyAt(now: number, dayOffset: number, hour: number): number {
  const { y, m, d } = nyParts(now);
  const guess = Date.UTC(y, m - 1, d + dayOffset, hour);
  return guess - nyOffset(guess);
}

/**
 * Parse a loose "when" (ISO string, or phrases like "now", "tomorrow morning", "tonight",
 * "this weekend", "sunday afternoon") into an epoch ms. Returns now for anything unrecognised.
 */
export function parseWhen(input: string | undefined, now: number): { t: number; label: string } {
  const s = (input ?? "").trim().toLowerCase();
  if (!s || /\b(now|right now|currently|today|at the moment)\b/.test(s) && !/tomorrow|tonight|weekend|morning|afternoon|evening/.test(s))
    return { t: now, label: "right now" };
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(input!);
    if (Number.isFinite(t)) {
      if (t < now - 2 * HOUR) return { t: now, label: `right now (${input} is in the past; assessed current conditions)` };
      return { t: Math.max(t, now), label: t - now < HOUR ? "right now" : fmtNY(t, { weekday: "long", hour: "numeric", minute: "2-digit" }) };
    }
  }
  const hourFor = /morning|sunrise|dawn/.test(s) ? 8 : /afternoon/.test(s) ? 14 : /evening|tonight|sunset/.test(s) ? 18 : null;
  const { wd } = nyParts(now);
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let dayOffset: number | null = null;
  if (/tomorrow/.test(s)) dayOffset = 1;
  else if (/tonight|this (morning|afternoon|evening)|later today/.test(s)) dayOffset = 0;
  else if (/weekend/.test(s)) {
    const i = days.indexOf(wd.toLowerCase().slice(0, 3));
    if (i === 6 || i === 0) return { t: now, label: "this weekend (now)" };
    dayOffset = 6 - i;
  } else {
    const named = days.findIndex((d) => new RegExp(`\\b${d}`).test(s));
    if (named >= 0) dayOffset = (named - days.indexOf(wd.toLowerCase().slice(0, 3)) + 7) % 7;
  }
  if (dayOffset === null && hourFor === null) return { t: now, label: "right now" };
  const hour = hourFor ?? 9;
  let t = nyAt(now, dayOffset ?? 0, hour);
  if (t < now) t = dayOffset === null ? nyAt(now, 1, hour) : Math.max(t, now);
  return { t, label: t - now < HOUR ? "right now" : fmtNY(t, { weekday: "long", hour: "numeric" }) };
}

/** ISO 8601 with the America/New_York offset, e.g. 2026-09-27T08:00:00-04:00. */
export function isoNY(t: number): string {
  const off = nyOffset(t);
  const local = new Date(t + off).toISOString().slice(0, 19);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off) / 60_000;
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
