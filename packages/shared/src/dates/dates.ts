/**
 * Payroll calendar helpers (PRD §7.1).
 *
 * All timestamps are stored in UTC. Timezone conversion happens only for
 * period boundaries, schedule triggers, and display. Default period:
 * Saturday 00:00:00.000 through Friday 23:59:59.999 in the company timezone.
 *
 * DST correctness: period boundaries are computed in the company timezone's
 * wall clock using date-fns-tz, so a 7-day period spans exactly seven local
 * days regardless of daylight-saving transitions.
 */
import { toZonedTime as utcToZonedTime, fromZonedTime as zonedTimeToUtc } from 'date-fns-tz';

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const DEFAULT_WEEK_START_DAY = 6; // Saturday (0 = Sunday)
export const DEFAULT_TIMEZONE = 'America/Chicago';

export interface PeriodBoundaries {
  startAt: Date;
  endAt: Date;
}

/**
 * Given a UTC timestamp, return the wall-clock date in `timezone` advanced by
 * `deltaDays` local days.
 */
function shiftZonedDays(ts: Date, timezone: string, deltaDays: number): Date {
  const zoned = utcToZonedTime(ts, timezone);
  zoned.setDate(zoned.getDate() + deltaDays);
  return zoned;
}

/**
 * UTC boundary of the start of the period (week-start day 00:00 local) that
 * contains `ts`. `ts` is a UTC Date; the search happens in local wall clock.
 */
export function periodStartUtc(ts: Date, timezone: string, weekStartDay = DEFAULT_WEEK_START_DAY): Date {
  const zoned = utcToZonedTime(ts, timezone);
  const day = zoned.getDay();
  let diff = (day - weekStartDay + 7) % 7;
  const start = new Date(zoned.getTime());
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diff);
  return zonedTimeToUtc(start, timezone);
}

/** Boundaries of the period containing `ts`. */
export function periodContaining(ts: Date, timezone: string, weekStartDay = DEFAULT_WEEK_START_DAY): PeriodBoundaries {
  const startAt = periodStartUtc(ts, timezone, weekStartDay);
  const endWallClock = shiftZonedDays(startAt, timezone, 7);
  endWallClock.setMilliseconds(-1);
  const endAt = zonedTimeToUtc(endWallClock, timezone);
  return { startAt, endAt };
}

/**
 * The period that has just ended at or before `now`. Used by the scheduler:
 * at Saturday 00:00 local, this is the period ending Friday 23:59:59.999 local.
 */
export function justEndedPeriod(now: Date, timezone: string, weekStartDay = DEFAULT_WEEK_START_DAY): PeriodBoundaries {
  const currentStart = periodStartUtc(now, timezone, weekStartDay);
  const startWallClock = utcToZonedTime(currentStart, timezone);
  const prevStart = zonedTimeToUtc(shiftZonedDays(currentStart, timezone, -7), timezone);
  const endWallClock = utcToZonedTime(currentStart, timezone);
  endWallClock.setMilliseconds(-1);
  const endAt = zonedTimeToUtc(endWallClock, timezone);
  void startWallClock;
  return { startAt: prevStart, endAt };
}

/** Format a UTC date in the given timezone as ISO-like local string. */
export function formatInZone(ts: Date, timezone: string): string {
  const zoned = utcToZonedTime(ts, timezone);
  return formatLocalISO(zoned);
}

/** Format a zoned Date to "YYYY-MM-DD HH:mm:ss" using local fields. */
export function formatLocalISO(zoned: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())} ` +
    `${pad(zoned.getHours())}:${pad(zoned.getMinutes())}:${pad(zoned.getSeconds())}`;
}

/** Format a UTC date in the given timezone as "YYYY-MM-DD". */
export function formatDateInZone(ts: Date, timezone: string): string {
  const zoned = utcToZonedTime(ts, timezone);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`;
}

export { utcToZonedTime, zonedTimeToUtc };
