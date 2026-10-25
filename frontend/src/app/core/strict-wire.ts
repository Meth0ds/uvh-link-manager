/**
 * Strict wire-scalar decoding, owned by one module.
 *
 * The panel reads three kinds of scalar off the wire — route ids, local
 * `datetime-local` values and HTTP dates — and each used to be parsed wherever
 * it was needed, with the engine's permissive parsers standing in for a
 * grammar. `Number("1e3")` is 1000, `new Date("2026-02-30")` rolls into March
 * and `Date.parse("1.5")` is a date: a nonsense value could become a request
 * for some row's data, or a silent wait, instead of being refused at the
 * client edge.
 *
 * The contract every decoder here obeys — `strict-wire.spec.ts` holds each of
 * them to it:
 *
 *   1. `string | null | undefined` in, `T | null` out. Absent or
 *      non-conforming input answers `null` — never a guess, never a default,
 *      never a throw.
 *   2. Shape before meaning: a closed grammar first, then semantics (calendar
 *      round-trip, safe integers). The engine's parser is never the first
 *      reader of user-supplied text.
 *   3. The value must survive the round trip that proves it exists — a
 *      calendar day rebuilt in UTC, a canonical date printed back — so a
 *      rolled-over day or an inconsistent weekday cannot pose as real.
 *   4. Tolerance exists only where the wire format itself is tolerant — the
 *      HTTP-date case fold and `-0000` naming GMT — and stops exactly there.
 */

/** The shared decoder shape: strict in, `T | null` out. */
export type StrictDecoder<T> = (raw: string | null | undefined) => T | null;

/**
 * A route parameter is only an id when it is written the way the app writes
 * one. Parsing loosely turned a nonsense URL into a request for some row's
 * data instead of refusing it at the client edge.
 */
export const parseRouteId: StrictDecoder<number> = (raw) =>
  raw != null && /^[1-9]\d{0,17}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * A `datetime-local` value is only an instant when it names the moment it
 * displays. The result is that instant in epoch milliseconds; the wall-clock
 * fields survive no further than this function.
 */
export const parseLocalDateTime: StrictDecoder<number> = (raw) => {
  const match = LOCAL_DATE_TIME.exec(raw ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (hour > 23 || minute > 59) return null;

  // Calendar validity is resolved in UTC: a local parse would move the date
  // itself around a DST shift and turn a real day into a rejected one. This
  // round trip is also what refuses `2026-02-30`, which the engine would
  // happily roll into March.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return null;
  }

  // A wall clock inside a spring-forward gap does not exist in local time, and
  // the runtime answers `new Date(2026, 2, 29, 2, 30)` in Europe/Madrid with
  // 03:30 rather than with the value that was asked for. The hour is skipped by
  // the zone, not rejected by the calendar — and it is a value the browser's own
  // datetime-local input produces — so the drift it causes is accepted. Every
  // other difference means the field does not name the moment it displays.
  const parsed = new Date(year, month - 1, day, hour, minute);
  const asked = Date.UTC(year, month - 1, day, hour, minute);
  const answered = Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes());
  const driftMinutes = Math.round((answered - asked) / 60_000);
  return driftMinutes >= 0 && driftMinutes <= 180 ? parsed.getTime() : null;
};

const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}:\d{2}:\d{2}) (GMT|-0000)$/i;

/**
 * An HTTP date (IMF-fixdate) as an instant in epoch milliseconds. Accept the
 * wire format, not `Date.parse`'s permissive numeric shorthand (for example
 * "1.5", which could otherwise become a date). The wire is tolerant where
 * tolerance is part of the format — day and month names are case-insensitive,
 * and `-0000` names GMT — and strict after that: the canonical form must
 * survive a `toUTCString()` round trip, which rejects rolled-over calendar
 * dates ("Tue, 31 Feb …") and inconsistent weekdays without rejecting a merely
 * differently-spelled valid date.
 */
export const parseHttpDate: StrictDecoder<number> = (raw) => {
  const match = IMF_FIXDATE.exec(raw ?? "");
  if (!match) return null;
  const canonical = `${titleCase(match[1])}, ${match[2]} ${titleCase(match[3])} ${match[4]} ${match[5]} GMT`;
  const timestamp = Date.parse(canonical);
  return Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === canonical ? timestamp : null;
};

/**
 * The inverse of {@link parseLocalDateTime}: an instant as the `datetime-local`
 * input that names it, local wall-clock time. Empty text for anything that
 * names no instant — an encoder that invents a value is a decoder that guessed.
 */
export function localDateTimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The instant a `datetime-local` value names, as the ISO text the API takes.
 * The refusal must stay visible to the caller: an earlier decode turned
 * garbage into `null` deep inside a form and quietly issued a token the
 * operator believed would expire, without any expiry at all.
 */
export function localDateTimeIso(raw: string | null | undefined): string | null {
  const instant = parseLocalDateTime(raw ?? "");
  return instant === null ? null : new Date(instant).toISOString();
}

const TIME_ONLY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type ZoneParts = { year: number; month: number; day: number; hour: number; minute: number };

// The formatter depends on the zone, never on the current date or account.
// Bound the cache because the helper is also used with caller-supplied zones.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  if (zoneFormatters.size >= 32) {
    const oldest = zoneFormatters.keys().next().value;
    if (oldest !== undefined) zoneFormatters.delete(oldest);
  }
  zoneFormatters.set(timezone, formatter);
  return formatter;
}

function zoneParts(instant: Date, timezone: string): ZoneParts | null {
  try {
    const parts = zoneFormatter(timezone).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const output = { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
    return Object.values(output).every(Number.isInteger) ? output : null;
  } catch {
    return null;
  }
}

/** Convert a recurring UTC minute to the local wall clock for today's zone offset. */
export function utcTimeToLocalTime(raw: string | null | undefined, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, reference = new Date()): string | null {
  if (!TIME_ONLY.test(raw ?? "")) return null;
  const parts = zoneParts(reference, timezone);
  if (!parts) return raw ?? null;
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, Number(raw!.slice(0, 2)), Number(raw!.slice(3)));
  const local = zoneParts(new Date(utc), timezone);
  return local ? String(local.hour).padStart(2, "0") + ":" + String(local.minute).padStart(2, "0") : raw!;
}

/** Convert a local recurring minute to UTC; nonexistent DST hours return null. */
export function localTimeToUtcTime(raw: string | null | undefined, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, reference = new Date()): string | null {
  if (!TIME_ONLY.test(raw ?? "")) return null;
  const date = zoneParts(reference, timezone);
  if (!date) return raw ?? null;
  const desired = Date.UTC(date.year, date.month - 1, date.day, Number(raw!.slice(0, 2)), Number(raw!.slice(3)));
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zoneParts(new Date(instant), timezone);
    if (!actual) return null;
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    instant += desired - actualWall;
  }
  const verified = zoneParts(new Date(instant), timezone);
  if (!verified || Date.UTC(verified.year, verified.month - 1, verified.day, verified.hour, verified.minute) !== desired) return null;
  const utc = zoneParts(new Date(instant), "UTC");
  return utc ? String(utc.hour).padStart(2, "0") + ":" + String(utc.minute).padStart(2, "0") : null;
}

/** Wire tolerance is a case tolerance only; the canonical names stay fixed. */
function titleCase(name: string): string {
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}
