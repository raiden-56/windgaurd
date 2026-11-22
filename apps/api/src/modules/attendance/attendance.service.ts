import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { AuditService } from '../../common/audit.service';
import { AuthUser, can } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { PrismaService } from '../../common/prisma.service';
import { dateKey, dateOnly, fmtMinute, shiftWindow, todayIn } from '../../common/time';
import type {
  AttendanceRecord,
  AttendanceRegister,
  AttendanceStatus,
  EntryMode,
  OrganizationSettings,
  Prisma,
  Shift,
  Site,
} from '../../generated/prisma/client';
import { RosterService } from '../shifts/roster.service';
import { derive } from './attendance.engine';

export interface Slot {
  siteId: string;
  shiftId: string;
  workDate: string;
}

export interface ActionMeta {
  mode?: EntryMode;
  deviceRecordedAt?: Date;
  offlineClientId?: string;
}

interface SlotCtx {
  site: Site;
  shift: Shift;
  settings: OrganizationSettings;
  workDate: string;
  window: { start: Date; end: Date };
}

const SNAPSHOT_FIELDS = ['status', 'checkInAt', 'checkOutAt', 'workedMinutes', 'overtimeMinutes', 'lateMinutes', 'isLate', 'remarks', 'entryMode'] as const;

export function snapshot(r: Partial<AttendanceRecord> | null) {
  if (!r) return null;
  const out: Record<string, unknown> = {};
  for (const k of SNAPSHOT_FIELDS) out[k] = (r as any)[k] ?? null;
  return out;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly roster: RosterService,
    private readonly notify: NotifyService,
  ) {}

  async slotContext(user: AuthUser, slot: Slot): Promise<SlotCtx> {
    const site = await this.org.site(user, slot.siteId);
    const shift = await this.org.shift(user, slot.shiftId, site.id);
    const settings = await this.org.settings(user.orgId);
    return { site, shift, settings, workDate: slot.workDate, window: shiftWindow(slot.workDate, shift, site.timezone) };
  }

  private async register(ctx: SlotCtx, orgId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    return tx.attendanceRegister.upsert({
      where: { siteId_shiftId_workDate: { siteId: ctx.site.id, shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate) } },
      create: { organizationId: orgId, siteId: ctx.site.id, shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate) },
      update: {},
    });
  }

  /** Direct edits are allowed only while the register is open (or with an explicit grant). */
  private assertEditable(user: AuthUser, reg: AttendanceRegister, opts: { allowSubmittedCheckout?: boolean } = {}) {
    if (reg.status === 'OPEN') return;
    if (reg.status === 'SUBMITTED' && opts.allowSubmittedCheckout) return;
    if (reg.status === 'LOCKED') throw new ConflictException('This register is locked. Raise an attendance correction instead.');
    if (!can(user, 'attendance.editHistorical')) {
      throw new ConflictException(`This register is ${reg.status.toLowerCase()}. Raise an attendance correction instead.`);
    }
  }

  private assertNotFuture(ctx: SlotCtx) {
    const today = todayIn(ctx.site.timezone);
    if (ctx.workDate > today) throw new BadRequestException('Attendance cannot be recorded for a future date');
  }

  /** Employees must belong to the organization; unrostered workers are added to the roster (audited). */
  private async ensureRostered(user: AuthUser, ctx: SlotCtx, employeeIds: string[], tx: Prisma.TransactionClient) {
    const emps = await tx.employee.findMany({
      where: { id: { in: employeeIds }, organizationId: user.orgId, deletedAt: null },
      select: { id: true, status: true, fullName: true },
    });
    if (emps.length !== new Set(employeeIds).size) throw new NotFoundException('One or more employees were not found');
    const inactive = emps.find((e) => e.status !== 'ACTIVE');
    if (inactive) throw new BadRequestException(`${inactive.fullName} is not an active employee`);
    const rostered = await tx.rosterEntry.findMany({
      where: { shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate), employeeId: { in: employeeIds } },
      select: { employeeId: true },
    });
    const have = new Set(rostered.map((r) => r.employeeId));
    const missing = employeeIds.filter((id) => !have.has(id));
    if (missing.length) {
      await tx.rosterEntry.createMany({
        data: missing.map((employeeId) => ({
          organizationId: user.orgId,
          siteId: ctx.site.id,
          shiftId: ctx.shift.id,
          employeeId,
          workDate: dateOnly(ctx.workDate),
          createdById: user.id,
        })),
        skipDuplicates: true,
      });
      await this.audit.logMany(
        user,
        missing.map((employeeId) => ({
          action: 'roster.add_adhoc',
          entity: 'RosterEntry',
          entityId: employeeId,
          after: { siteId: ctx.site.id, shiftId: ctx.shift.id, workDate: ctx.workDate },
        })),
        tx,
      );
    }
  }

  // ───────────────────────────── Register view ─────────────────────────────

  async getRegister(user: AuthUser, slot: Slot) {
    const ctx = await this.slotContext(user, slot);
    const today = todayIn(ctx.site.timezone);
    if (slot.workDate <= DateTime.fromISO(today).plus({ days: 14 }).toISODate()!) {
      await this.roster.ensureDay(user.orgId, ctx.site.id, slot.workDate);
    }
    const reg = await this.register(ctx, user.orgId);
    if (reg.status === 'OPEN' && slot.workDate <= today) await this.materializeLeave(user, ctx, reg);

    const [entries, records, approvals, corrections] = await Promise.all([
      this.prisma.rosterEntry.findMany({
        where: { shiftId: ctx.shift.id, workDate: dateOnly(slot.workDate) },
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true, phone: false, designation: { select: { name: true } }, status: true } },
          location: { select: { name: true } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { shiftId: ctx.shift.id, workDate: dateOnly(slot.workDate) },
        include: { markedBy: { select: { fullName: true } } },
      }),
      this.prisma.attendanceApproval.findMany({ where: { registerId: reg.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.attendanceCorrection.findMany({
        where: { status: 'PENDING', attendance: { shiftId: ctx.shift.id, workDate: dateOnly(slot.workDate) } },
        select: { attendanceId: true },
      }),
    ]);
    const recByEmp = new Map(records.map((r) => [r.employeeId, r]));
    const pendingCorr = new Set(corrections.map((c) => c.attendanceId));
    const seen = new Set<string>();
    const now = Date.now();
    const incompleteAfter = ctx.settings.incompleteAfterHours * 3600_000;

    const rows = entries.map((e) => {
      seen.add(e.employeeId);
      return this.row(e.employee, e.location?.name ?? null, recByEmp.get(e.employeeId) ?? null, pendingCorr, ctx, now, incompleteAfter);
    });
    // Records that exist without a roster entry (e.g. roster entry removed later) still show.
    const orphanIds = records.filter((r) => !seen.has(r.employeeId)).map((r) => r.employeeId);
    if (orphanIds.length) {
      const emps = await this.prisma.employee.findMany({
        where: { id: { in: orphanIds } },
        select: { id: true, employeeCode: true, fullName: true, designation: { select: { name: true } }, status: true },
      });
      for (const emp of emps) rows.push(this.row(emp, null, recByEmp.get(emp.id)!, pendingCorr, ctx, now, incompleteAfter));
    }
    rows.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

    return {
      site: { id: ctx.site.id, name: ctx.site.name, code: ctx.site.code, timezone: ctx.site.timezone },
      shift: {
        id: ctx.shift.id,
        name: ctx.shift.name,
        code: ctx.shift.code,
        start: fmtMinute(ctx.shift.startMinute),
        end: fmtMinute(ctx.shift.endMinute),
        overnight: ctx.shift.endMinute <= ctx.shift.startMinute,
        breakMinutes: ctx.shift.breakMinutes,
        graceMinutes: ctx.shift.graceMinutes,
        requiredWorkers: ctx.shift.requiredWorkers,
        color: ctx.shift.color,
      },
      workDate: slot.workDate,
      isToday: slot.workDate === today,
      scheduledStart: ctx.window.start,
      scheduledEnd: ctx.window.end,
      register: {
        id: reg.id,
        status: reg.status,
        submittedAt: reg.submittedAt,
        approvals: approvals.map((a) => ({ action: a.action, actorName: a.actorName, note: a.note, createdAt: a.createdAt })),
      },
      requireApproval: ctx.settings.requireRegisterApproval,
      counts,
      rows,
    };
  }

  private row(
    emp: { id: string; employeeCode: string; fullName: string; designation: { name: string } | null; status: string },
    locationName: string | null,
    rec: (AttendanceRecord & { markedBy?: { fullName: string } | null }) | null,
    pendingCorr: Set<string>,
    ctx: SlotCtx,
    now: number,
    incompleteAfter: number,
  ) {
    let status: AttendanceStatus = rec?.status ?? 'PENDING';
    // Open check-ins past shift end + tolerance display as incomplete.
    if (status === 'ON_DUTY' && rec && !rec.checkOutAt && now > ctx.window.end.getTime() + incompleteAfter) status = 'INCOMPLETE';
    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      designation: emp.designation?.name ?? null,
      location: locationName,
      status,
      record: rec
        ? {
            id: rec.id,
            status: rec.status,
            checkInAt: rec.checkInAt,
            checkOutAt: rec.checkOutAt,
            workedMinutes: rec.workedMinutes,
            hoursFromSchedule: !rec.checkInAt && rec.workedMinutes != null,
            overtimeMinutes: rec.overtimeMinutes,
            lateMinutes: rec.lateMinutes,
            isLate: rec.isLate,
            remarks: rec.remarks,
            entryMode: rec.entryMode,
            markedBy: rec.markedBy?.fullName ?? null,
            version: rec.version,
            updatedAt: rec.updatedAt,
            syncedAt: rec.syncedAt,
            deviceRecordedAt: rec.deviceRecordedAt,
            pendingCorrection: pendingCorr.has(rec.id),
          }
        : null,
    };
  }

  /** Approved leave becomes a LEAVE record automatically so it is never counted as absence. */
  private async materializeLeave(user: AuthUser, ctx: SlotCtx, reg: AttendanceRegister) {
    const day = dateOnly(ctx.workDate);
    const leaves = await this.prisma.leaveRecord.findMany({
      where: {
        organizationId: user.orgId,
        status: 'APPROVED',
        startDate: { lte: day },
        endDate: { gte: day },
        employee: { rosterEntries: { some: { shiftId: ctx.shift.id, workDate: day } } },
      },
      select: { employeeId: true, leaveType: true },
    });
    if (!leaves.length) return;
    const existing = await this.prisma.attendanceRecord.findMany({
      where: { shiftId: ctx.shift.id, workDate: day, employeeId: { in: leaves.map((l) => l.employeeId) } },
      select: { employeeId: true },
    });
    const have = new Set(existing.map((e) => e.employeeId));
    const todo = leaves.filter((l) => !have.has(l.employeeId));
    if (!todo.length) return;
    await this.prisma.attendanceRecord.createMany({
      data: todo.map((l) => ({
        organizationId: user.orgId,
        siteId: ctx.site.id,
        shiftId: ctx.shift.id,
        employeeId: l.employeeId,
        workDate: day,
        status: 'LEAVE' as const,
        scheduledStart: ctx.window.start,
        scheduledEnd: ctx.window.end,
        workedMinutes: 0,
        remarks: `Approved ${l.leaveType.toLowerCase()} leave`,
        registerId: reg.id,
      })),
      skipDuplicates: true,
    });
    await this.audit.logMany(
      null,
      todo.map((l) => ({
        orgId: user.orgId,
        action: 'attendance.auto_leave',
        entity: 'AttendanceRecord',
        entityId: l.employeeId,
        after: { status: 'LEAVE', workDate: ctx.workDate, shiftId: ctx.shift.id },
      })),
    );
  }

  // ───────────────────────────── Mutations ─────────────────────────────

  async mark(
    user: AuthUser,
    slot: Slot,
    entries: { employeeId: string; status: AttendanceStatus; remarks?: string | null }[],
    meta: ActionMeta = {},
  ) {
    const ctx = await this.slotContext(user, slot);
    this.assertNotFuture(ctx);
    if (!entries.length) return { updated: 0, records: [] };
    const mode = meta.mode ?? 'LIVE';

    return this.prisma.$transaction(async (tx) => {
      const reg = await this.register(ctx, user.orgId, tx);
      this.assertEditable(user, reg);
      await this.ensureRostered(user, ctx, entries.map((e) => e.employeeId), tx);
      const existing = await tx.attendanceRecord.findMany({
        where: { shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate), employeeId: { in: entries.map((e) => e.employeeId) } },
      });
      const byEmp = new Map(existing.map((r) => [r.employeeId, r]));
      const audits = [];
      const results = [];
      for (const entry of entries) {
        const prev = byEmp.get(entry.employeeId) ?? null;
        if (prev?.checkInAt && ['ABSENT', 'LEAVE', 'WEEKLY_OFF', 'HOLIDAY', 'NOT_SCHEDULED'].includes(entry.status)) {
          throw new ConflictException('An employee with a recorded check-in cannot be marked absent or on leave. Raise a correction instead.');
        }
        const base = {
          status: entry.status,
          checkInAt: prev?.checkInAt ?? null,
          checkOutAt: prev?.checkOutAt ?? null,
          scheduledStart: ctx.window.start,
          scheduledEnd: ctx.window.end,
        };
        const d = derive(base, ctx.shift, ctx.settings);
        const remarks = entry.remarks !== undefined ? entry.remarks || null : (prev?.remarks ?? null);
        const data = {
          status: d.status,
          workedMinutes: d.workedMinutes,
          overtimeMinutes: d.overtimeMinutes,
          lateMinutes: d.lateMinutes,
          isLate: d.isLate,
          remarks,
          markedById: user.id,
          entryMode: mode,
          registerId: reg.id,
          ...(meta.deviceRecordedAt ? { deviceRecordedAt: meta.deviceRecordedAt, syncedAt: new Date() } : {}),
          ...(meta.offlineClientId ? { offlineClientId: meta.offlineClientId } : {}),
        };
        const saved = prev
          ? await tx.attendanceRecord.update({ where: { id: prev.id }, data: { ...data, version: { increment: 1 } } })
          : await tx.attendanceRecord.create({
              data: {
                ...data,
                organizationId: user.orgId,
                siteId: ctx.site.id,
                shiftId: ctx.shift.id,
                employeeId: entry.employeeId,
                workDate: dateOnly(ctx.workDate),
                scheduledStart: ctx.window.start,
                scheduledEnd: ctx.window.end,
              },
            });
        results.push(saved);
        audits.push({
          action: prev ? 'attendance.update' : 'attendance.create',
          entity: 'AttendanceRecord',
          entityId: saved.id,
          before: snapshot(prev),
          after: { ...snapshot(saved), employeeId: entry.employeeId, workDate: ctx.workDate, shiftId: ctx.shift.id, siteId: ctx.site.id, mode },
        });
      }
      await this.audit.logMany(user, audits, tx);
      return { updated: results.length, records: results.map((r) => ({ id: r.id, employeeId: r.employeeId, status: r.status, version: r.version })) };
    });
  }

  private resolveTime(ctx: SlotCtx, time: string | undefined | null, reason: string | undefined | null, mode: EntryMode) {
    if (!time) return { at: new Date(), manual: false };
    const at = new Date(time);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Invalid time');
    if (at.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Time cannot be in the future');
    const manual = mode !== 'OFFLINE';
    if (manual && !reason?.trim()) throw new BadRequestException('A reason is required when entering a time manually');
    return { at, manual };
  }

  async checkIn(
    user: AuthUser,
    slot: Slot,
    input: { employeeId: string; time?: string | null; reason?: string | null; remarks?: string | null },
    meta: ActionMeta = {},
  ) {
    const ctx = await this.slotContext(user, slot);
    this.assertNotFuture(ctx);
    const mode = meta.mode ?? 'LIVE';
    const { at, manual } = this.resolveTime(ctx, input.time, input.reason, mode);
    const earliest = ctx.window.start.getTime() - 4 * 3600_000;
    if (at.getTime() < earliest || at.getTime() > ctx.window.end.getTime()) {
      throw new BadRequestException('Check-in time must be between 4 hours before the shift starts and the shift end');
    }

    return this.prisma.$transaction(async (tx) => {
      const reg = await this.register(ctx, user.orgId, tx);
      this.assertEditable(user, reg);
      await this.ensureRostered(user, ctx, [input.employeeId], tx);
      const prev = await tx.attendanceRecord.findUnique({
        where: { employeeId_shiftId_workDate: { employeeId: input.employeeId, shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate) } },
      });
      if (prev?.checkInAt) throw new ConflictException('Employee is already checked in for this shift. Use a correction to change the time.');
      // A worker earlier marked absent on this still-open register may be checked in (late arrival).
      const d = derive(
        { status: 'ON_DUTY', checkInAt: at, checkOutAt: null, scheduledStart: ctx.window.start, scheduledEnd: ctx.window.end },
        ctx.shift,
        ctx.settings,
      );
      const data = {
        status: 'ON_DUTY' as const,
        checkInAt: at,
        workedMinutes: null,
        lateMinutes: d.lateMinutes,
        isLate: d.isLate,
        markedById: user.id,
        entryMode: (manual ? 'MANUAL' : mode) as EntryMode,
        manualReason: manual ? input.reason!.trim() : (prev?.manualReason ?? null),
        remarks: input.remarks ?? prev?.remarks ?? null,
        registerId: reg.id,
        ...(meta.deviceRecordedAt ? { deviceRecordedAt: meta.deviceRecordedAt, syncedAt: new Date() } : {}),
        ...(meta.offlineClientId ? { offlineClientId: meta.offlineClientId } : {}),
      };
      const saved = prev
        ? await tx.attendanceRecord.update({ where: { id: prev.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.attendanceRecord.create({
            data: {
              ...data,
              organizationId: user.orgId,
              siteId: ctx.site.id,
              shiftId: ctx.shift.id,
              employeeId: input.employeeId,
              workDate: dateOnly(ctx.workDate),
              scheduledStart: ctx.window.start,
              scheduledEnd: ctx.window.end,
            },
          });
      await this.audit.log(
        user,
        {
          action: 'attendance.check_in',
          entity: 'AttendanceRecord',
          entityId: saved.id,
          before: snapshot(prev),
          after: { ...snapshot(saved), employeeId: input.employeeId, workDate: ctx.workDate, shiftId: ctx.shift.id, siteId: ctx.site.id, mode: saved.entryMode },
          reason: manual ? input.reason : null,
        },
        tx,
      );
      return saved;
    });
  }

  async checkOut(
    user: AuthUser,
    slot: Slot,
    input: { employeeId: string; time?: string | null; reason?: string | null; remarks?: string | null },
    meta: ActionMeta = {},
  ) {
    const ctx = await this.slotContext(user, slot);
    const mode = meta.mode ?? 'LIVE';
    const { at, manual } = this.resolveTime(ctx, input.time, input.reason, mode);

    return this.prisma.$transaction(async (tx) => {
      const reg = await this.register(ctx, user.orgId, tx);
      this.assertEditable(user, reg, { allowSubmittedCheckout: true });
      const prev = await tx.attendanceRecord.findUnique({
        where: { employeeId_shiftId_workDate: { employeeId: input.employeeId, shiftId: ctx.shift.id, workDate: dateOnly(ctx.workDate) } },
      });
      if (!prev?.checkInAt) throw new ConflictException('Employee has not been checked in for this shift');
      if (prev.checkOutAt) throw new ConflictException('Employee is already checked out. Use a correction to change the time.');
      if (at <= prev.checkInAt) throw new BadRequestException('Check-out must be after check-in');
      if (at.getTime() - prev.checkInAt.getTime() > 20 * 3600_000) throw new BadRequestException('Shift span cannot exceed 20 hours');
      const d = derive(
        { status: prev.status, checkInAt: prev.checkInAt, checkOutAt: at, scheduledStart: prev.scheduledStart, scheduledEnd: prev.scheduledEnd },
        ctx.shift,
        ctx.settings,
        { autoStatusOnCheckout: true },
      );
      const saved = await tx.attendanceRecord.update({
        where: { id: prev.id },
        data: {
          checkOutAt: at,
          status: d.status,
          workedMinutes: d.workedMinutes,
          overtimeMinutes: d.overtimeMinutes,
          markedById: user.id,
          remarks: input.remarks ?? prev.remarks,
          ...(manual ? { entryMode: 'MANUAL' as const, manualReason: [prev.manualReason, input.reason!.trim()].filter(Boolean).join(' | ') } : {}),
          ...(mode === 'OFFLINE' ? { entryMode: 'OFFLINE' as const } : {}),
          ...(meta.deviceRecordedAt ? { deviceRecordedAt: meta.deviceRecordedAt, syncedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.log(
        user,
        {
          action: 'attendance.check_out',
          entity: 'AttendanceRecord',
          entityId: saved.id,
          before: snapshot(prev),
          after: snapshot(saved),
          reason: manual ? input.reason : null,
        },
        tx,
      );
      return saved;
    });
  }

  async updateRemarks(user: AuthUser, id: string, remarks: string | null) {
    const rec = await this.prisma.attendanceRecord.findFirst({ where: { id, organizationId: user.orgId }, include: { register: true } });
    if (!rec) throw new NotFoundException('Attendance record not found');
    if (user.siteIds && !user.siteIds.includes(rec.siteId)) throw new ForbiddenException('Not your site');
    if (rec.register) this.assertEditable(user, rec.register);
    const saved = await this.prisma.attendanceRecord.update({ where: { id }, data: { remarks, version: { increment: 1 } } });
    await this.audit.log(user, { action: 'attendance.remarks', entity: 'AttendanceRecord', entityId: id, before: { remarks: rec.remarks }, after: { remarks } });
    return saved;
  }

  // ───────────────────────────── Register workflow ─────────────────────────────

  async submit(user: AuthUser, slot: Slot, note?: string | null) {
    const view = await this.getRegister(user, slot);
    if (view.register.status !== 'OPEN') throw new ConflictException(`Register is already ${view.register.status.toLowerCase()}`);
    const pending = view.rows.filter((r) => r.status === 'PENDING');
    if (pending.length) {
      throw new ConflictException({
        message: `${pending.length} employee(s) are not marked yet`,
        pending: pending.map((p) => ({ employeeId: p.employeeId, name: p.fullName })),
      });
    }
    const settings = await this.org.settings(user.orgId);
    const nextStatus = settings.requireRegisterApproval ? 'SUBMITTED' : 'APPROVED';
    const summary: Record<string, number> = { ...view.counts, total: view.rows.length };
    const absent = view.rows.filter((r) => r.status === 'ABSENT');

    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRegister.update({
        where: { id: view.register.id },
        data: { status: nextStatus, submittedById: user.id, submittedAt: new Date(), summary },
      });
      await tx.attendanceApproval.create({
        data: { registerId: view.register.id, action: 'SUBMITTED', actorId: user.id, actorName: user.fullName, note: note ?? null },
      });
      if (nextStatus === 'APPROVED') {
        await tx.attendanceApproval.create({
          data: { registerId: view.register.id, action: 'APPROVED', actorId: user.id, actorName: 'Auto-approved (rule)', note: null },
        });
      }
      await this.audit.log(
        user,
        { action: 'register.submit', entity: 'AttendanceRegister', entityId: view.register.id, after: { ...summary, workDate: slot.workDate, shift: view.shift.name, site: view.site.name }, reason: note },
        tx,
      );
    });

    const label = `${view.site.name} · ${view.shift.name} · ${slot.workDate}`;
    if (nextStatus === 'SUBMITTED') {
      await this.notify.toAdmins(user.orgId, {
        type: 'register.pending_approval',
        title: 'Attendance register awaiting approval',
        body: `${user.fullName} submitted ${label}: ${summary.PRESENT ?? 0} present, ${absent.length} absent.`,
        link: `/attendance?site=${slot.siteId}&shift=${slot.shiftId}&date=${slot.workDate}`,
        severity: 'INFO',
        dedupeKey: `register-submit:${view.register.id}`,
      });
    }
    if (absent.length) {
      await this.notify.toAdmins(user.orgId, {
        type: 'attendance.absent',
        title: `${absent.length} employee(s) absent`,
        body: `${label}: ${absent.slice(0, 5).map((a) => a.fullName).join(', ')}${absent.length > 5 ? '…' : ''}`,
        link: `/attendance?site=${slot.siteId}&shift=${slot.shiftId}&date=${slot.workDate}`,
        severity: 'WARNING',
        dedupeKey: `absent:${view.register.id}`,
      });
    }
    return { status: nextStatus, summary };
  }

  async decide(user: AuthUser, registerId: string, action: 'APPROVE' | 'REOPEN' | 'LOCK', note?: string | null) {
    const reg = await this.prisma.attendanceRegister.findFirst({
      where: { id: registerId, organizationId: user.orgId },
      include: { site: true, shift: true },
    });
    if (!reg) throw new NotFoundException('Register not found');
    const transitions: Record<string, { from: string[]; to: 'APPROVED' | 'OPEN' | 'LOCKED'; label: string }> = {
      APPROVE: { from: ['SUBMITTED'], to: 'APPROVED', label: 'APPROVED' },
      REOPEN: { from: ['SUBMITTED', 'APPROVED'], to: 'OPEN', label: 'REOPENED' },
      LOCK: { from: ['APPROVED', 'SUBMITTED'], to: 'LOCKED', label: 'LOCKED' },
    };
    const t = transitions[action];
    if (!t.from.includes(reg.status)) throw new ConflictException(`Cannot ${action.toLowerCase()} a ${reg.status.toLowerCase()} register`);
    if (action === 'REOPEN' && !note?.trim()) throw new BadRequestException('A reason is required to reopen a register');

    await this.prisma.$transaction(async (tx) => {
      if (action !== 'REOPEN') {
        // Open check-ins on a finalized register past the shift end become incomplete.
        const open = await tx.attendanceRecord.findMany({ where: { registerId, status: 'ON_DUTY', checkOutAt: null, scheduledEnd: { lt: new Date() } } });
        for (const r of open) {
          await tx.attendanceRecord.update({ where: { id: r.id }, data: { status: 'INCOMPLETE', version: { increment: 1 } } });
        }
        if (open.length) {
          await this.audit.logMany(
            user,
            open.map((r) => ({ action: 'attendance.mark_incomplete', entity: 'AttendanceRecord', entityId: r.id, before: { status: 'ON_DUTY' }, after: { status: 'INCOMPLETE' } })),
            tx,
          );
        }
      }
      await tx.attendanceRegister.update({ where: { id: registerId }, data: { status: t.to } });
      await tx.attendanceApproval.create({ data: { registerId, action: t.label, actorId: user.id, actorName: user.fullName, note: note ?? null } });
      await this.audit.log(
        user,
        { action: `register.${action.toLowerCase()}`, entity: 'AttendanceRegister', entityId: registerId, before: { status: reg.status }, after: { status: t.to }, reason: note },
        tx,
      );
    });
    if (reg.submittedById && reg.submittedById !== user.id) {
      await this.notify.toUsers(user.orgId, [reg.submittedById], {
        type: `register.${action.toLowerCase()}`,
        title: `Register ${t.label.toLowerCase()}`,
        body: `${reg.site.name} · ${reg.shift.name} · ${dateKey(reg.workDate)} was ${t.label.toLowerCase()} by ${user.fullName}.${note ? ` Note: ${note}` : ''}`,
        link: `/attendance?site=${reg.siteId}&shift=${reg.shiftId}&date=${dateKey(reg.workDate)}`,
        severity: action === 'REOPEN' ? 'WARNING' : 'SUCCESS',
      });
    }
    return { status: t.to };
  }

  /** The shift (and work date) in progress right now at a site, accounting for overnight shifts. */
  async current(user: AuthUser, siteId: string) {
    const site = await this.org.site(user, siteId);
    const shifts = await this.prisma.shift.findMany({ where: { siteId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }] });
    const today = todayIn(site.timezone);
    const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
    const now = Date.now();
    for (const day of [today, yesterday]) {
      for (const s of shifts) {
        const w = shiftWindow(day, s, site.timezone);
        if (now >= w.start.getTime() && now < w.end.getTime()) return { workDate: day, shiftId: s.id };
      }
    }
    const upcoming = shifts.find((s) => shiftWindow(today, s, site.timezone).start.getTime() > now) ?? shifts[0];
    return { workDate: today, shiftId: upcoming?.id ?? null };
  }

  async registers(user: AuthUser, q: { status?: string; siteId?: string; from?: string; to?: string }) {
    if (q.siteId && user.siteIds && !user.siteIds.includes(q.siteId)) throw new ForbiddenException('Not your site');
    const regs = await this.prisma.attendanceRegister.findMany({
      where: {
        organizationId: user.orgId,
        ...(user.siteIds ? { siteId: { in: user.siteIds } } : {}),
        ...(q.siteId ? { siteId: q.siteId } : {}),
        ...(q.status ? { status: q.status as any } : {}),
        ...(q.from || q.to ? { workDate: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
      },
      include: { site: { select: { name: true, code: true } }, shift: { select: { name: true, code: true, color: true } } },
      orderBy: [{ workDate: 'desc' }, { shift: { sortOrder: 'asc' } }],
      take: 200,
    });
    const submitters = await this.prisma.user.findMany({ where: { id: { in: regs.map((r) => r.submittedById).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    return regs.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      shiftId: r.shiftId,
      date: dateKey(r.workDate),
      status: r.status,
      site: r.site,
      shift: r.shift,
      submittedAt: r.submittedAt,
      submittedBy: submitters.find((s) => s.id === r.submittedById)?.fullName ?? null,
      summary: r.summary,
    }));
  }

  /** Paginated cross-site attendance list (admin daily view). */
  async list(
    user: AuthUser,
    q: { date?: string; from?: string; to?: string; siteId?: string; shiftId?: string; status?: string; search?: string; page: number; pageSize: number; late?: boolean; mode?: string },
  ) {
    const where: Prisma.AttendanceRecordWhereInput = {
      organizationId: user.orgId,
      ...(user.siteIds ? { siteId: { in: user.siteIds } } : {}),
      ...(q.siteId ? { siteId: q.siteId } : {}),
      ...(q.shiftId ? { shiftId: q.shiftId } : {}),
      ...(q.status ? { status: q.status as AttendanceStatus } : {}),
      ...(q.late ? { isLate: true } : {}),
      ...(q.mode ? { entryMode: q.mode as EntryMode } : {}),
    };
    if (q.siteId && user.siteIds && !user.siteIds.includes(q.siteId)) throw new ForbiddenException('Not your site');
    if (q.date) where.workDate = dateOnly(q.date);
    else if (q.from || q.to) where.workDate = { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) };
    if (q.search) {
      where.employee = { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { employeeCode: { contains: q.search, mode: 'insensitive' } }] };
    }
    const [total, items] = await Promise.all([
      this.prisma.attendanceRecord.count({ where }),
      this.prisma.attendanceRecord.findMany({
        where,
        include: {
          employee: { select: { employeeCode: true, fullName: true, designation: { select: { name: true } } } },
          site: { select: { name: true, code: true, timezone: true } },
          shift: { select: { name: true, code: true, startMinute: true, endMinute: true, color: true } },
          markedBy: { select: { fullName: true } },
        },
        orderBy: [{ workDate: 'desc' }, { employee: { employeeCode: 'asc' } }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, items };
  }
}
