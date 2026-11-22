import { DateTime } from 'luxon';

/** YYYY-MM-DD → JS Date at UTC midnight (how Prisma stores @db.Date). */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** JS Date from a @db.Date column → YYYY-MM-DD. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}

export function addDays(key: string, days: number): string {
  return DateTime.fromISO(key, { zone: 'utc' }).plus({ days }).toISODate()!;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(key: string): number {
  return DateTime.fromISO(key, { zone: 'utc' }).weekday % 7;
}

export interface ShiftTimes {
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
}

/**
 * Absolute UTC window of a shift that starts on `workDate` in the site's timezone.
 * When endMinute <= startMinute the shift ends on the following calendar day, so a
 * 22:00–06:00 shift's checkout is still attributed to the original work date.
 */
export function shiftWindow(workDate: string, shift: ShiftTimes, tz: string) {
  const midnight = DateTime.fromISO(workDate, { zone: tz }).startOf('day');
  const start = midnight.plus({ minutes: shift.startMinute });
  let end = midnight.plus({ minutes: shift.endMinute });
  if (shift.endMinute <= shift.startMinute) end = end.plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

export function shiftDurationMinutes(shift: ShiftTimes) {
  const raw = shift.endMinute - shift.startMinute;
  return raw > 0 ? raw : raw + 1440;
}

/** Scheduled working minutes (duration minus break). */
export function scheduledNetMinutes(shift: ShiftTimes) {
  return Math.max(0, shiftDurationMinutes(shift) - shift.breakMinutes);
}

export function fmtMinute(m: number) {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function fmtLocal(d: Date | null | undefined, tz: string, fmt = 'HH:mm') {
  if (!d) return '';
  return DateTime.fromJSDate(d).setZone(tz).toFormat(fmt);
}

export function fmtHours(mins: number | null | undefined) {
  if (mins == null) return '';
  return `${Math.floor(mins / 60)}:${String(Math.round(mins % 60)).padStart(2, '0')}`;
}

export function periodRange(period: string, anchor: string, from?: string, to?: string) {
  const a = DateTime.fromISO(anchor, { zone: 'utc' });
  switch (period) {
    case 'daily':
      return { from: anchor, to: anchor };
    case 'weekly': {
      const s = a.startOf('week');
      return { from: s.toISODate()!, to: s.plus({ days: 6 }).toISODate()! };
    }
    case 'monthly':
      return { from: a.startOf('month').toISODate()!, to: a.endOf('month').toISODate()! };
    case 'quarterly':
      return { from: a.startOf('quarter').toISODate()!, to: a.endOf('quarter').toISODate()! };
    case 'yearly':
      return { from: a.startOf('year').toISODate()!, to: a.endOf('year').toISODate()! };
    default:
      return { from: from ?? anchor, to: to ?? from ?? anchor };
  }
}
