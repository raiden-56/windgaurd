import type { AttendanceStatus, OrganizationSettings, Shift } from '../../generated/prisma/client';
import { scheduledNetMinutes } from '../../common/time';

export const MARKABLE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'NOT_SCHEDULED'] as const;

export interface RecordTimes {
  status: AttendanceStatus;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  scheduledStart: Date;
  scheduledEnd: Date;
}

export interface Derived {
  status: AttendanceStatus;
  workedMinutes: number | null;
  overtimeMinutes: number;
  lateMinutes: number;
  isLate: boolean;
}

const mins = (ms: number) => Math.round(ms / 60000);

/**
 * Pure attendance calculation. Given a record's times and its shift rules, returns the
 * derived working hours, overtime, lateness and (on checkout) the resulting status.
 *
 * - Break minutes are deducted once the worked span reaches the half-day threshold.
 * - Late = check-in after scheduled start + grace period; lateMinutes counts from the start.
 * - Overtime = net worked minutes beyond the scheduled net duration, once the excess
 *   exceeds the organization's overtime threshold.
 * - Records marked Present / Half Day without times take hours from the schedule.
 */
export function derive(
  rec: RecordTimes,
  shift: Pick<Shift, 'startMinute' | 'endMinute' | 'breakMinutes' | 'graceMinutes'>,
  settings: Pick<OrganizationSettings, 'overtimeEnabled' | 'overtimeThresholdMins' | 'halfDayThresholdMins'>,
  opts: { autoStatusOnCheckout?: boolean } = {},
): Derived {
  let status = rec.status;
  let workedMinutes: number | null = null;
  let overtimeMinutes = 0;
  let lateMinutes = 0;
  let isLate = false;
  const net = scheduledNetMinutes(shift);

  if (rec.checkInAt) {
    const diff = mins(rec.checkInAt.getTime() - rec.scheduledStart.getTime());
    lateMinutes = Math.max(0, diff);
    isLate = diff > shift.graceMinutes;
  }

  if (rec.checkInAt && rec.checkOutAt) {
    const span = Math.max(0, mins(rec.checkOutAt.getTime() - rec.checkInAt.getTime()));
    workedMinutes = span >= settings.halfDayThresholdMins ? Math.max(0, span - shift.breakMinutes) : span;
    const excess = workedMinutes - net;
    overtimeMinutes = settings.overtimeEnabled && excess > settings.overtimeThresholdMins ? excess : 0;
    if (opts.autoStatusOnCheckout && ['ON_DUTY', 'PENDING', 'INCOMPLETE', 'PRESENT'].includes(status)) {
      status = workedMinutes < settings.halfDayThresholdMins ? 'HALF_DAY' : 'PRESENT';
    }
  } else if (!rec.checkInAt) {
    if (status === 'PRESENT') workedMinutes = net;
    else if (status === 'HALF_DAY') workedMinutes = Math.round(net / 2);
  }

  return { status, workedMinutes, overtimeMinutes, lateMinutes, isLate };
}

/** Day weight used for "working days" in reports and the muster roll. */
export function dayWeight(status: AttendanceStatus): number {
  switch (status) {
    case 'PRESENT':
    case 'ON_DUTY':
    case 'INCOMPLETE':
      return 1;
    case 'HALF_DAY':
      return 0.5;
    default:
      return 0;
  }
}

export interface Tally {
  scheduled: number;
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  weeklyOff: number;
  holiday: number;
  incomplete: number;
  onDuty: number;
  pending: number;
  late: number;
  workedMinutes: number;
  overtimeMinutes: number;
  workingDays: number;
}

export function emptyTally(): Tally {
  return {
    scheduled: 0,
    present: 0,
    absent: 0,
    leave: 0,
    halfDay: 0,
    weeklyOff: 0,
    holiday: 0,
    incomplete: 0,
    onDuty: 0,
    pending: 0,
    late: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    workingDays: 0,
  };
}

export function addToTally(t: Tally, r: { status: AttendanceStatus; workedMinutes: number | null; overtimeMinutes: number; isLate: boolean }) {
  if (r.status !== 'NOT_SCHEDULED') t.scheduled++;
  switch (r.status) {
    case 'PRESENT':
      t.present++;
      break;
    case 'ABSENT':
      t.absent++;
      break;
    case 'LEAVE':
      t.leave++;
      break;
    case 'HALF_DAY':
      t.halfDay++;
      break;
    case 'WEEKLY_OFF':
      t.weeklyOff++;
      break;
    case 'HOLIDAY':
      t.holiday++;
      break;
    case 'INCOMPLETE':
      t.incomplete++;
      break;
    case 'ON_DUTY':
      t.onDuty++;
      break;
    case 'PENDING':
      t.pending++;
      break;
  }
  if (r.isLate) t.late++;
  t.workedMinutes += r.workedMinutes ?? 0;
  t.overtimeMinutes += r.overtimeMinutes ?? 0;
  t.workingDays += dayWeight(r.status);
}

/**
 * Attendance % = working days / expected days, where expected days exclude weekly offs,
 * holidays, pending rows and (unless configured otherwise) approved leave.
 */
export function attendancePct(t: Tally, countLeave = false) {
  const expected = t.scheduled - t.weeklyOff - t.holiday - t.pending - (countLeave ? 0 : t.leave);
  if (expected <= 0) return null;
  return Math.round((t.workingDays / expected) * 1000) / 10;
}
