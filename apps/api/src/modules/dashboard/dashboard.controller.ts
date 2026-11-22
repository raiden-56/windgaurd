import { Controller, Get, Query } from '@nestjs/common';
import { DateTime } from 'luxon';
import { AuthUser, CurrentUser } from '../../common/context';
import { OrgService } from '../../common/org.service';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { addDays, dateKey, dateOnly, fmtMinute, shiftWindow, todayIn } from '../../common/time';
import { parse, z, zDate } from '../../common/zod';
import type { AttendanceStatus } from '../../generated/prisma/client';
import { dayWeight } from '../attendance/attendance.engine';

type Counts = Partial<Record<AttendanceStatus, number>>;

/** Attendance % from status counts (same rule as reports). */
function pct(c: Counts, countLeave: boolean) {
  const n = (s: AttendanceStatus) => c[s] ?? 0;
  const scheduled = Object.entries(c).reduce((a, [s, v]) => a + (s === 'NOT_SCHEDULED' ? 0 : (v ?? 0)), 0);
  const expected = scheduled - n('WEEKLY_OFF') - n('HOLIDAY') - n('PENDING') - (countLeave ? 0 : n('LEAVE'));
  const worked = (Object.entries(c) as [AttendanceStatus, number][]).reduce((a, [s, v]) => a + dayWeight(s) * v, 0);
  return expected > 0 ? Math.round((worked / expected) * 1000) / 10 : null;
}

@Controller()
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  private async scope(user: AuthUser, siteId?: string) {
    const sites = await this.prisma.site.findMany({
      where: {
        organizationId: user.orgId,
        isActive: true,
        ...(user.siteIds ? { id: { in: user.siteIds } } : {}),
        ...(siteId ? { id: siteId } : {}),
      },
      include: { shifts: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }] } },
      orderBy: { name: 'asc' },
    });
    return sites;
  }

  private async countsByDay(siteIds: string[], from: string, to: string) {
    const rows = await this.prisma.attendanceRecord.groupBy({
      by: ['workDate', 'status'],
      where: { siteId: { in: siteIds }, workDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      _count: true,
    });
    const map = new Map<string, Counts>();
    for (const r of rows) {
      const k = dateKey(r.workDate);
      const c = map.get(k) ?? {};
      c[r.status] = r._count;
      map.set(k, c);
    }
    return map;
  }

  @Get('dashboard')
  @Perm('attendance.read')
  async dashboard(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ siteId: z.string().optional() }), q);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const settings = await this.org.settings(user.orgId);
    const sites = await this.scope(user, p.siteId);
    const siteIds = sites.map((s) => s.id);
    const today = todayIn(org.timezone);
    const yesterday = addDays(today, -1);
    const now = Date.now();

    const [employees, supervisors, todayRecs, rosterToday, recentRecs, pendingRegisters, pendingCorrections, recentAudit, offlineSynced] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['siteId'], where: { organizationId: user.orgId, status: 'ACTIVE', deletedAt: null, siteId: { in: siteIds } }, _count: true }),
      this.prisma.user.findMany({
        where: { organizationId: user.orgId, role: 'SUPERVISOR', isActive: true, ...(p.siteId || user.siteIds ? { siteAssignments: { some: { siteId: { in: siteIds } } } } : {}) },
        select: { id: true, fullName: true, lastSeenAt: true, siteAssignments: { select: { siteId: true } } },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { siteId: { in: siteIds }, workDate: { in: [dateOnly(today), dateOnly(yesterday)] } },
        select: { id: true, siteId: true, shiftId: true, employeeId: true, workDate: true, status: true, isLate: true, checkInAt: true, checkOutAt: true, scheduledEnd: true, employee: { select: { fullName: true, employeeCode: true } } },
      }),
      this.prisma.rosterEntry.findMany({
        where: { siteId: { in: siteIds }, workDate: { in: [dateOnly(today), dateOnly(yesterday)] } },
        select: { siteId: true, shiftId: true, employeeId: true, workDate: true },
      }),
      this.countsByDay(siteIds, addDays(today, -400), today),
      this.prisma.attendanceRegister.findMany({
        where: { siteId: { in: siteIds }, status: 'SUBMITTED' },
        include: { site: { select: { name: true } }, shift: { select: { name: true } } },
        orderBy: { workDate: 'desc' },
        take: 10,
      }),
      this.prisma.attendanceCorrection.count({ where: { organizationId: user.orgId, status: 'PENDING', attendance: { siteId: { in: siteIds } } } }),
      this.prisma.auditLog.findMany({
        where: {
          organizationId: user.orgId,
          OR: [{ action: { startsWith: 'attendance.' } }, { action: { startsWith: 'register.' } }, { action: { startsWith: 'roster.' } }, { action: { startsWith: 'handover.' } }, { action: { startsWith: 'sync.' } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 14,
      }),
      this.prisma.attendanceRecord.count({ where: { siteId: { in: siteIds }, entryMode: 'OFFLINE', syncedAt: { gte: new Date(now - 86400_000) } } }),
    ]);

    const todays = todayRecs.filter((r) => dateKey(r.workDate) === today);
    const counts: Counts = {};
    for (const r of todays) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const rosteredToday = rosterToday.filter((r) => dateKey(r.workDate) === today);
    const recKey = new Set(todayRecs.map((r) => `${r.employeeId}|${r.shiftId}|${dateKey(r.workDate)}`));
    const pendingToday = rosteredToday.filter((r) => !recKey.has(`${r.employeeId}|${r.shiftId}|${today}`)).length;

    const incompleteMs = settings.incompleteAfterHours * 3600_000;
    const missingCheckouts = todayRecs.filter((r) => r.status === 'INCOMPLETE' || (r.status === 'ON_DUTY' && !r.checkOutAt && r.scheduledEnd.getTime() + incompleteMs < now));
    const onDutyNow = todayRecs.filter((r) => r.status === 'ON_DUTY' && !r.checkOutAt && r.scheduledEnd.getTime() + incompleteMs >= now).length;

    // Shift slots for today: required vs rostered vs present, plus "not yet marked" after start + 30 min
    const shiftSlots: { siteId: string; siteName: string; shiftId: string; shiftName: string; code: string; sortOrder: number; start: string; end: string; required: number; rostered: number; present: number; notMarked: number; started: boolean; inProgress: boolean }[] = [];
    for (const s of sites) {
      for (const sh of s.shifts) {
        const dow = DateTime.fromISO(today, { zone: 'utc' }).weekday % 7;
        if (!sh.activeDays.includes(dow)) continue;
        const w = shiftWindow(today, sh, s.timezone);
        const rostered = rosteredToday.filter((r) => r.shiftId === sh.id);
        const recs = todays.filter((r) => r.shiftId === sh.id);
        const present = recs.filter((r) => ['PRESENT', 'ON_DUTY', 'HALF_DAY', 'INCOMPLETE'].includes(r.status)).length;
        const marked = new Set(recs.map((r) => r.employeeId));
        shiftSlots.push({
          siteId: s.id,
          siteName: s.name,
          shiftId: sh.id,
          shiftName: sh.name,
          code: sh.code,
          sortOrder: sh.sortOrder,
          start: fmtMinute(sh.startMinute),
          end: fmtMinute(sh.endMinute),
          required: sh.requiredWorkers,
          rostered: rostered.length,
          present,
          notMarked: rostered.filter((r) => !marked.has(r.employeeId)).length,
          started: now > w.start.getTime() + 30 * 60_000,
          inProgress: now >= w.start.getTime() && now < w.end.getTime(),
        });
      }
    }
    const openShiftPositions = shiftSlots.reduce((a, s) => a + Math.max(0, s.required - s.rostered), 0);

    // Shift distribution aggregated by shift name across sites
    const dist = new Map<string, { name: string; code: string; sortOrder: number; required: number; filled: number; present: number }>();
    for (const s of shiftSlots) {
      const d = dist.get(s.shiftName) ?? { name: s.shiftName, code: s.code, sortOrder: s.sortOrder, required: 0, filled: 0, present: 0 };
      d.required += s.required;
      d.filled += s.rostered;
      d.present += s.present;
      dist.set(s.shiftName, d);
    }

    // Trends
    const daily = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((d) => {
      const c = recentRecs.get(d) ?? {};
      return {
        date: d,
        present: (c.PRESENT ?? 0) + (c.ON_DUTY ?? 0) + (c.INCOMPLETE ?? 0),
        absent: c.ABSENT ?? 0,
        leave: c.LEAVE ?? 0,
        halfDay: c.HALF_DAY ?? 0,
        pct: pct(c, settings.countLeaveInPercentage),
      };
    });
    const bucket = (keyOf: (d: string) => string, labelOf: (k: string) => string, keys: string[]) => {
      const acc = new Map<string, Counts>(keys.map((k) => [k, {}]));
      for (const [d, c] of recentRecs) {
        const k = keyOf(d);
        const a = acc.get(k);
        if (!a) continue;
        for (const [s, v] of Object.entries(c) as [AttendanceStatus, number][]) a[s] = (a[s] ?? 0) + v;
      }
      return keys.map((k) => {
        const c = acc.get(k)!;
        return { key: k, label: labelOf(k), present: (c.PRESENT ?? 0) + (c.ON_DUTY ?? 0) + (c.INCOMPLETE ?? 0), absent: c.ABSENT ?? 0, leave: c.LEAVE ?? 0, pct: pct(c, settings.countLeaveInPercentage) };
      });
    };
    const t = DateTime.fromISO(today, { zone: 'utc' });
    const weekKeys = Array.from({ length: 12 }, (_, i) => t.startOf('week').minus({ weeks: 11 - i }).toISODate()!);
    const weekly = bucket((d) => DateTime.fromISO(d, { zone: 'utc' }).startOf('week').toISODate()!, (k) => DateTime.fromISO(k).toFormat('dd LLL'), weekKeys);
    const monthKeys = Array.from({ length: 12 }, (_, i) => t.startOf('month').minus({ months: 11 - i }).toFormat('yyyy-MM'));
    const monthly = bucket((d) => d.slice(0, 7), (k) => DateTime.fromISO(`${k}-01`).toFormat('LLL yy'), monthKeys);
    const yearKeys = [String(t.year - 1), String(t.year)];
    const yearly = bucket((d) => d.slice(0, 4), (k) => k, yearKeys);

    // Site-wise workforce today
    const empBySite = new Map(employees.map((e) => [e.siteId, e._count]));
    const siteWorkforce = sites.map((s) => {
      const recs = todays.filter((r) => r.siteId === s.id);
      const slots = shiftSlots.filter((x) => x.siteId === s.id);
      return {
        siteId: s.id,
        name: s.name,
        code: s.code,
        employees: empBySite.get(s.id) ?? 0,
        present: recs.filter((r) => ['PRESENT', 'ON_DUTY', 'HALF_DAY', 'INCOMPLETE'].includes(r.status)).length,
        absent: recs.filter((r) => r.status === 'ABSENT').length,
        leave: recs.filter((r) => r.status === 'LEAVE').length,
        openPositions: slots.reduce((a, x) => a + Math.max(0, x.required - x.rostered), 0),
      };
    });

    const quietSupervisors = supervisors.filter((sup) => {
      const supSites = sup.siteAssignments.map((a) => a.siteId);
      const active = shiftSlots.some((s) => s.inProgress && supSites.includes(s.siteId));
      return active && (!sup.lastSeenAt || now - sup.lastSeenAt.getTime() > 90 * 60_000);
    });

    return {
      today,
      generatedAt: new Date().toISOString(),
      kpis: {
        activeEmployees: employees.reduce((a, e) => a + e._count, 0),
        supervisors: supervisors.length,
        present: (counts.PRESENT ?? 0) + (counts.ON_DUTY ?? 0) + (counts.INCOMPLETE ?? 0) + (counts.HALF_DAY ?? 0),
        absent: counts.ABSENT ?? 0,
        onLeave: counts.LEAVE ?? 0,
        halfDay: counts.HALF_DAY ?? 0,
        onDutyNow,
        openShifts: openShiftPositions,
        attendancePct: pct(counts, settings.countLeaveInPercentage),
        lateCheckins: todays.filter((r) => r.isLate).length,
        incompleteCheckouts: missingCheckouts.length,
        notMarked: pendingToday,
        rosteredToday: rosteredToday.length,
      },
      overview: { counts, pending: pendingToday, week: daily.slice(-7) },
      shiftDistribution: [...dist.values()].sort((a, b) => a.sortOrder - b.sortOrder),
      shiftSlots,
      siteWorkforce,
      trends: { daily, weekly, monthly, yearly },
      recentActivity: recentAudit.map((a) => ({ id: a.id, action: a.action, userName: a.userName, userRole: a.userRole, entity: a.entity, after: a.newValues, reason: a.reason, createdAt: a.createdAt })),
      attention: {
        notMarked: shiftSlots.filter((s) => s.started && s.notMarked > 0).map((s) => ({ siteId: s.siteId, siteName: s.siteName, shiftId: s.shiftId, shiftName: s.shiftName, count: s.notMarked, date: today })),
        missingCheckouts: missingCheckouts.slice(0, 20).map((r) => ({
          id: r.id,
          employee: r.employee.fullName,
          employeeCode: r.employee.employeeCode,
          siteId: r.siteId,
          shiftId: r.shiftId,
          date: dateKey(r.workDate),
          siteName: sites.find((s) => s.id === r.siteId)?.name,
          shiftName: sites.flatMap((s) => s.shifts).find((s) => s.id === r.shiftId)?.name,
        })),
        missingCheckoutsTotal: missingCheckouts.length,
        unfilledShifts: shiftSlots.filter((s) => s.rostered < s.required).map((s) => ({ siteId: s.siteId, siteName: s.siteName, shiftName: s.shiftName, required: s.required, rostered: s.rostered })),
        quietSupervisors: quietSupervisors.map((s) => ({ id: s.id, fullName: s.fullName, lastSeenAt: s.lastSeenAt })),
        pendingRegisters: pendingRegisters.map((r) => ({ id: r.id, siteId: r.siteId, shiftId: r.shiftId, siteName: r.site.name, shiftName: r.shift.name, date: dateKey(r.workDate), submittedAt: r.submittedAt })),
        pendingCorrections,
        offlineSynced24h: offlineSynced,
      },
    };
  }

  @Get('analytics')
  @Perm('reports.read')
  async analytics(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ from: zDate, to: zDate, siteId: z.string().optional() }), q);
    const settings = await this.org.settings(user.orgId);
    const sites = await this.scope(user, p.siteId);
    const siteIds = sites.map((s) => s.id);
    const recs = await this.prisma.attendanceRecord.findMany({
      where: { siteId: { in: siteIds }, workDate: { gte: dateOnly(p.from), lte: dateOnly(p.to) } },
      select: {
        siteId: true,
        shiftId: true,
        employeeId: true,
        workDate: true,
        status: true,
        isLate: true,
        lateMinutes: true,
        overtimeMinutes: true,
        workedMinutes: true,
        entryMode: true,
      },
    });
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDow: Counts[] = DOW.map(() => ({}));
    const bySite = new Map<string, Counts & { _late?: number; _ot?: number; _worked?: number }>();
    const byShift = new Map<string, { total: number; late: number; lateMins: number }>();
    const byEmp = new Map<string, { absent: number; late: number; total: number }>();
    const modes: Record<string, number> = {};
    const byWeek = new Map<string, { total: number; late: number; counts: Counts }>();
    for (const r of recs) {
      const d = dateKey(r.workDate);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      byDow[dow][r.status] = (byDow[dow][r.status] ?? 0) + 1;
      const s = bySite.get(r.siteId) ?? {};
      s[r.status] = (s[r.status] ?? 0) + 1;
      s._late = (s._late ?? 0) + (r.isLate ? 1 : 0);
      s._ot = (s._ot ?? 0) + r.overtimeMinutes;
      s._worked = (s._worked ?? 0) + (r.workedMinutes ?? 0);
      bySite.set(r.siteId, s);
      if (['PRESENT', 'HALF_DAY', 'INCOMPLETE', 'ON_DUTY'].includes(r.status)) {
        const sh = byShift.get(r.shiftId) ?? { total: 0, late: 0, lateMins: 0 };
        sh.total++;
        if (r.isLate) {
          sh.late++;
          sh.lateMins += r.lateMinutes;
        }
        byShift.set(r.shiftId, sh);
      }
      const e = byEmp.get(r.employeeId) ?? { absent: 0, late: 0, total: 0 };
      e.total++;
      if (r.status === 'ABSENT') e.absent++;
      if (r.isLate) e.late++;
      byEmp.set(r.employeeId, e);
      modes[r.entryMode] = (modes[r.entryMode] ?? 0) + 1;
      const wk = DateTime.fromISO(d, { zone: 'utc' }).startOf('week').toISODate()!;
      const w = byWeek.get(wk) ?? { total: 0, late: 0, counts: {} };
      w.counts[r.status] = (w.counts[r.status] ?? 0) + 1;
      if (['PRESENT', 'HALF_DAY', 'INCOMPLETE', 'ON_DUTY'].includes(r.status)) w.total++;
      if (r.isLate) w.late++;
      byWeek.set(wk, w);
    }
    const shifts = sites.flatMap((s) => s.shifts.map((sh) => ({ ...sh, siteName: s.name })));
    const topIds = [...byEmp.entries()].sort((a, b) => b[1].absent - a[1].absent || b[1].late - a[1].late).slice(0, 10);
    const emps = await this.prisma.employee.findMany({ where: { id: { in: topIds.map(([id]) => id) } }, select: { id: true, employeeCode: true, fullName: true, site: { select: { name: true } } } });
    return {
      range: { from: p.from, to: p.to },
      totalRecords: recs.length,
      dayOfWeek: DOW.map((label, i) => ({ label, pct: pct(byDow[i], settings.countLeaveInPercentage), absent: byDow[i].ABSENT ?? 0 })),
      sites: sites.map((s) => {
        const c = bySite.get(s.id) ?? {};
        const presentish = (c.PRESENT ?? 0) + (c.HALF_DAY ?? 0) + (c.INCOMPLETE ?? 0) + (c.ON_DUTY ?? 0);
        return {
          siteId: s.id,
          name: s.name,
          code: s.code,
          pct: pct(c, settings.countLeaveInPercentage),
          absent: c.ABSENT ?? 0,
          leave: c.LEAVE ?? 0,
          lateRate: presentish ? Math.round(((c._late ?? 0) / presentish) * 1000) / 10 : null,
          overtimeHours: Math.round((c._ot ?? 0) / 6) / 10,
          workedHours: Math.round((c._worked ?? 0) / 6) / 10,
        };
      }),
      lateByShift: shifts
        .map((sh) => {
          const v = byShift.get(sh.id) ?? { total: 0, late: 0, lateMins: 0 };
          return { shiftId: sh.id, label: `${sh.siteName.split(' ')[0]} · ${sh.code}`, name: sh.name, siteName: sh.siteName, lateRate: v.total ? Math.round((v.late / v.total) * 1000) / 10 : 0, late: v.late, avgLateMins: v.late ? Math.round(v.lateMins / v.late) : 0 };
        })
        .filter((x) => x.late > 0 || byShift.has(x.shiftId)),
      punctualityTrend: [...byWeek.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([wk, w]) => ({ week: wk, label: DateTime.fromISO(wk).toFormat('dd LLL'), lateRate: w.total ? Math.round((w.late / w.total) * 1000) / 10 : 0, pct: pct(w.counts, settings.countLeaveInPercentage) })),
      topAbsentees: topIds
        .filter(([, v]) => v.absent > 0)
        .map(([id, v]) => {
          const e = emps.find((x) => x.id === id);
          return { employeeId: id, employeeCode: e?.employeeCode, fullName: e?.fullName, site: e?.site?.name, absent: v.absent, late: v.late, total: v.total };
        }),
      entryModes: modes,
    };
  }
}
