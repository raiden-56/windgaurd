import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { AuthUser } from '../../common/context';
import { OrgService } from '../../common/org.service';
import { PrismaService } from '../../common/prisma.service';
import { dateKey, dateOnly, eachDay, fmtHours, fmtLocal, periodRange, todayIn } from '../../common/time';
import type { AttendanceStatus, Prisma } from '../../generated/prisma/client';
import { addToTally, attendancePct, dayWeight, emptyTally, Tally } from '../attendance/attendance.engine';
import type { Column, ReportDoc, Section } from './export.service';

export interface ReportParams {
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  date?: string;
  from?: string;
  to?: string;
  siteId?: string;
  projectId?: string;
  employeeId?: string;
  designationId?: string;
  supervisorId?: string;
  shiftId?: string;
  status?: AttendanceStatus;
}

export const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  HALF_DAY: 'Half Day',
  WEEKLY_OFF: 'Weekly Off',
  HOLIDAY: 'Holiday',
  ON_DUTY: 'On Duty',
  NOT_SCHEDULED: 'Not Scheduled',
  PENDING: 'Pending',
  INCOMPLETE: 'Incomplete',
};

export const MUSTER_COLORS: Record<string, string> = {
  A: '#FDE2E2',
  L: '#EDE4FD',
  H: '#FEF0D7',
  IC: '#FFE7D6',
  WO: '#E5E9EF',
  PH: '#E5E9EF',
};

const hrs = (m: number) => Math.round((m / 60) * 10) / 10;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  private where(user: AuthUser, p: ReportParams, from: string, to: string): Prisma.AttendanceRecordWhereInput {
    if (p.siteId && user.siteIds && !user.siteIds.includes(p.siteId)) throw new BadRequestException('Not your site');
    return {
      organizationId: user.orgId,
      workDate: { gte: dateOnly(from), lte: dateOnly(to) },
      ...(user.siteIds ? { siteId: { in: user.siteIds } } : {}),
      ...(p.siteId ? { siteId: p.siteId } : {}),
      ...(p.projectId ? { site: { projectId: p.projectId } } : {}),
      ...(p.employeeId ? { employeeId: p.employeeId } : {}),
      ...(p.designationId ? { employee: { designationId: p.designationId } } : {}),
      ...(p.supervisorId ? { markedById: p.supervisorId } : {}),
      ...(p.shiftId ? { shiftId: p.shiftId } : {}),
      ...(p.status ? { status: p.status } : {}),
    };
  }

  async build(user: AuthUser, p: ReportParams) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const settings = await this.org.settings(user.orgId);
    const anchor = p.date ?? todayIn(org.timezone);
    const { from, to } = periodRange(p.period, anchor, p.from, p.to);
    if (from > to) throw new BadRequestException('Start date must be before end date');
    const days = eachDay(from, to);
    if (days.length > 400) throw new BadRequestException('Choose a range of at most 400 days');

    const records = await this.prisma.attendanceRecord.findMany({
      where: this.where(user, p, from, to),
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true, designation: { select: { name: true } } } },
        site: { select: { id: true, name: true, code: true, timezone: true } },
        shift: { select: { name: true, code: true } },
        markedBy: { select: { fullName: true } },
      },
      orderBy: [{ workDate: 'asc' }, { employee: { employeeCode: 'asc' } }],
    });

    const [site, project, employee, shift, supervisor, designation] = await Promise.all([
      p.siteId ? this.prisma.site.findUnique({ where: { id: p.siteId }, select: { name: true, code: true } }) : null,
      p.projectId ? this.prisma.project.findUnique({ where: { id: p.projectId }, select: { name: true } }) : null,
      p.employeeId ? this.prisma.employee.findUnique({ where: { id: p.employeeId }, select: { fullName: true, employeeCode: true } }) : null,
      p.shiftId ? this.prisma.shift.findUnique({ where: { id: p.shiftId }, select: { name: true } }) : null,
      p.supervisorId ? this.prisma.user.findUnique({ where: { id: p.supervisorId }, select: { fullName: true } }) : null,
      p.designationId ? this.prisma.designation.findUnique({ where: { id: p.designationId }, select: { name: true } }) : null,
    ]);
    const filters = [
      project && `Project: ${project.name}`,
      employee && `Employee: ${employee.fullName} (${employee.employeeCode})`,
      designation && `Designation: ${designation.name}`,
      shift && `Shift: ${shift.name}`,
      supervisor && `Marked by: ${supervisor.fullName}`,
      p.status && `Status: ${STATUS_LABEL[p.status]}`,
    ].filter(Boolean) as string[];

    const periodLabel =
      p.period === 'daily'
        ? DateTime.fromISO(from).toFormat('dd LLL yyyy (cccc)')
        : p.period === 'monthly'
          ? DateTime.fromISO(from).toFormat('LLLL yyyy')
          : p.period === 'yearly'
            ? DateTime.fromISO(from).toFormat('yyyy')
            : `${DateTime.fromISO(from).toFormat('dd LLL yyyy')} – ${DateTime.fromISO(to).toFormat('dd LLL yyyy')}`;

    const meta = {
      company: org.name,
      site: site ? `${site.name} (${site.code})` : user.siteIds ? 'Assigned sites' : 'All sites',
      period: p.period,
      periodLabel,
      from,
      to,
      generatedAt: new Date().toISOString(),
      generatedBy: user.fullName,
      filters,
    };

    const total = emptyTally();
    for (const r of records) addToTally(total, r);
    const totals = { ...total, attendancePct: attendancePct(total, settings.countLeaveInPercentage) };

    const daily = records.map((r) => ({
      id: r.id,
      date: dateKey(r.workDate),
      employeeId: r.employee.id,
      employeeCode: r.employee.employeeCode,
      fullName: r.employee.fullName,
      designation: r.employee.designation?.name ?? '',
      site: r.site.name,
      shift: r.shift.name,
      shiftCode: r.shift.code,
      inTime: fmtLocal(r.checkInAt, r.site.timezone, 'HH:mm'),
      outTime: r.checkOutAt ? fmtLocal(r.checkOutAt, r.site.timezone, dateKey(r.workDate) === fmtLocal(r.checkOutAt, r.site.timezone, 'yyyy-MM-dd') ? 'HH:mm' : 'HH:mm (+1d)') : '',
      workedMinutes: r.workedMinutes,
      hours: fmtHours(r.workedMinutes),
      overtimeMinutes: r.overtimeMinutes,
      overtime: r.overtimeMinutes ? fmtHours(r.overtimeMinutes) : '',
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      late: r.isLate ? `Late ${r.lateMinutes}m` : '',
      isLate: r.isLate,
      remarks: r.remarks ?? '',
      markedBy: r.markedBy?.fullName ?? '',
      entryMode: r.entryMode,
    }));

    // Employee-wise summary
    const byEmp = new Map<string, { info: (typeof daily)[number]; tally: Tally; cells: Record<string, string[]> }>();
    for (const [i, r] of records.entries()) {
      const d = daily[i];
      let e = byEmp.get(r.employeeId);
      if (!e) {
        e = { info: d, tally: emptyTally(), cells: {} };
        byEmp.set(r.employeeId, e);
      }
      addToTally(e.tally, r);
      (e.cells[d.date] ??= []).push(r.status);
    }
    const abbr = settings.abbreviations as Record<string, string>;
    const employees = [...byEmp.values()]
      .sort((a, b) => a.info.employeeCode.localeCompare(b.info.employeeCode, undefined, { numeric: true }))
      .map((e) => ({
        employeeId: e.info.employeeId,
        employeeCode: e.info.employeeCode,
        fullName: e.info.fullName,
        designation: e.info.designation,
        site: e.info.site,
        ...e.tally,
        workedHours: hrs(e.tally.workedMinutes),
        overtimeHours: hrs(e.tally.overtimeMinutes),
        attendancePct: attendancePct(e.tally, settings.countLeaveInPercentage),
        cells: Object.fromEntries(Object.entries(e.cells).map(([k, v]) => [k, v.map((s) => abbr[s] ?? s).join('/')])),
      }));

    // Month-wise and site-wise (quarterly / yearly / long custom ranges)
    const byMonth = new Map<string, Tally>();
    const bySite = new Map<string, { name: string; tally: Tally }>();
    const byDay = new Map<string, Tally>();
    for (const r of records) {
      const m = dateKey(r.workDate).slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, emptyTally());
      addToTally(byMonth.get(m)!, r);
      if (!bySite.has(r.siteId)) bySite.set(r.siteId, { name: r.site.name, tally: emptyTally() });
      addToTally(bySite.get(r.siteId)!.tally, r);
      const d = dateKey(r.workDate);
      if (!byDay.has(d)) byDay.set(d, emptyTally());
      addToTally(byDay.get(d)!, r);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, t]) => ({ month, label: DateTime.fromISO(`${month}-01`).toFormat('LLL yyyy'), ...t, workedHours: hrs(t.workedMinutes), overtimeHours: hrs(t.overtimeMinutes), attendancePct: attendancePct(t, settings.countLeaveInPercentage) }));
    const sites = [...bySite.entries()].map(([id, s]) => ({ siteId: id, site: s.name, ...s.tally, workedHours: hrs(s.tally.workedMinutes), overtimeHours: hrs(s.tally.overtimeMinutes), attendancePct: attendancePct(s.tally, settings.countLeaveInPercentage) }));
    const trend = days.map((d) => {
      const t = byDay.get(d) ?? emptyTally();
      return { date: d, present: t.present + t.onDuty + t.incomplete, absent: t.absent, leave: t.leave, halfDay: t.halfDay, attendancePct: attendancePct(t, settings.countLeaveInPercentage) };
    });

    return { meta, days, totals: { ...totals, workedHours: hrs(total.workedMinutes), overtimeHours: hrs(total.overtimeMinutes) }, daily, employees, months, sites, trend, abbreviations: abbr };
  }

  /** Shapes a built report into the document sections for export. */
  toDocument(report: Awaited<ReturnType<ReportsService['build']>>): ReportDoc {
    const { meta } = report;
    const titleMap: Record<string, string> = {
      daily: 'Daily Attendance Report',
      weekly: 'Weekly Attendance Report',
      monthly: 'Monthly Attendance Report',
      quarterly: 'Quarterly Attendance Report',
      yearly: 'Yearly Attendance Report',
      custom: 'Attendance Report',
    };
    const docMeta = [
      { label: 'Company', value: meta.company },
      { label: 'Site', value: meta.site },
      { label: 'Reporting period', value: meta.periodLabel },
      { label: 'Generated on', value: DateTime.fromISO(meta.generatedAt).setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm') },
      { label: 'Generated by', value: meta.generatedBy },
      ...(meta.filters.length ? [{ label: 'Filters', value: meta.filters.join(' · ') }] : []),
    ];
    const sections: Section[] = [];
    const t = report.totals;
    const summaryCols: Column[] = [
      { key: 'sl', label: 'S.No', width: 5, align: 'right' },
      { key: 'employeeCode', label: 'Emp ID', width: 9 },
      { key: 'fullName', label: 'Employee Name', width: 20 },
      { key: 'designation', label: 'Designation', width: 14 },
      { key: 'site', label: 'Site', width: 16 },
      { key: 'present', label: 'Present', width: 7, align: 'right' },
      { key: 'absent', label: 'Absent', width: 7, align: 'right' },
      { key: 'leave', label: 'Leave', width: 6, align: 'right' },
      { key: 'halfDay', label: 'Half Day', width: 7, align: 'right' },
      { key: 'weeklyOff', label: 'Wkly Off', width: 7, align: 'right' },
      { key: 'late', label: 'Late', width: 6, align: 'right' },
      { key: 'workingDays', label: 'Working Days', width: 8, align: 'right' },
      { key: 'workedHours', label: 'Hours', width: 7, align: 'right' },
      { key: 'overtimeHours', label: 'OT Hrs', width: 7, align: 'right' },
      { key: 'pct', label: 'Att. %', width: 7, align: 'right' },
    ];
    const summaryRows = report.employees.map((e, i) => ({ ...e, sl: i + 1, pct: e.attendancePct == null ? '–' : `${e.attendancePct}%` }));
    const summaryTotals = {
      fullName: 'Total',
      present: t.present,
      absent: t.absent,
      leave: t.leave,
      halfDay: t.halfDay,
      weeklyOff: t.weeklyOff,
      late: t.late,
      workingDays: t.workingDays,
      workedHours: t.workedHours,
      overtimeHours: t.overtimeHours,
      pct: t.attendancePct == null ? '–' : `${t.attendancePct}%`,
    };

    if (meta.period === 'daily' || meta.from === meta.to) {
      sections.push({
        name: 'Daily Register',
        columns: [
          { key: 'sl', label: 'S.No', width: 5, align: 'right' },
          { key: 'employeeCode', label: 'Emp ID', width: 9 },
          { key: 'fullName', label: 'Employee Name', width: 20 },
          { key: 'designation', label: 'Designation', width: 14 },
          { key: 'site', label: 'Site', width: 15 },
          { key: 'shift', label: 'Shift', width: 11 },
          { key: 'inTime', label: 'IN', width: 7 },
          { key: 'outTime', label: 'OUT', width: 10 },
          { key: 'hours', label: 'Hours', width: 7, align: 'right' },
          { key: 'statusLabel', label: 'Status', width: 10 },
          { key: 'late', label: 'Late', width: 8 },
          { key: 'remarks', label: 'Remarks', width: 18 },
        ],
        rows: report.daily.map((d, i) => ({ ...d, sl: i + 1 })),
        totals: { fullName: `Present ${t.present + t.onDuty + t.incomplete} · Absent ${t.absent} · Leave ${t.leave}`, hours: `${t.workedHours}h` },
      });
    } else {
      sections.push({ name: 'Employee Summary', columns: summaryCols, rows: summaryRows, totals: summaryTotals });
      if (report.days.length <= 31) {
        const cols: Column[] = [
          { key: 'employeeCode', label: 'Emp ID', width: 9 },
          { key: 'fullName', label: 'Employee', width: 18 },
          ...report.days.map((d) => ({ key: d, label: DateTime.fromISO(d).toFormat(report.days.length > 7 ? 'd' : 'ccc d'), width: report.days.length > 7 ? 3.2 : 8, align: 'center' as const })),
          { key: 'workingDays', label: 'Total', width: 5, align: 'right' },
        ];
        sections.push({
          name: 'Attendance Matrix',
          columns: cols,
          rows: report.employees.map((e) => ({ employeeCode: e.employeeCode, fullName: e.fullName, ...e.cells, workingDays: e.workingDays })),
          cellColors: MUSTER_COLORS,
          compact: report.days.length > 7,
        });
      }
      if (report.months.length > 1) {
        sections.push({
          name: 'Monthly Summary',
          columns: [
            { key: 'label', label: 'Month', width: 12 },
            { key: 'scheduled', label: 'Scheduled', width: 8, align: 'right' },
            { key: 'present', label: 'Present', width: 8, align: 'right' },
            { key: 'absent', label: 'Absent', width: 8, align: 'right' },
            { key: 'leave', label: 'Leave', width: 8, align: 'right' },
            { key: 'halfDay', label: 'Half Day', width: 8, align: 'right' },
            { key: 'workingDays', label: 'Working Days', width: 9, align: 'right' },
            { key: 'workedHours', label: 'Hours', width: 9, align: 'right' },
            { key: 'overtimeHours', label: 'OT Hrs', width: 8, align: 'right' },
            { key: 'pct', label: 'Att. %', width: 8, align: 'right' },
          ],
          rows: report.months.map((m) => ({ ...m, pct: m.attendancePct == null ? '–' : `${m.attendancePct}%` })),
          totals: { label: 'Total', ...summaryTotals, scheduled: t.scheduled },
        });
      }
      if (report.sites.length > 1 && (meta.period === 'yearly' || meta.period === 'quarterly' || meta.period === 'custom')) {
        sections.push({
          name: 'Site-wise Summary',
          columns: [
            { key: 'site', label: 'Site', width: 18 },
            { key: 'present', label: 'Present', width: 8, align: 'right' },
            { key: 'absent', label: 'Absent', width: 8, align: 'right' },
            { key: 'leave', label: 'Leave', width: 8, align: 'right' },
            { key: 'workingDays', label: 'Working Days', width: 9, align: 'right' },
            { key: 'workedHours', label: 'Hours', width: 9, align: 'right' },
            { key: 'pct', label: 'Att. %', width: 8, align: 'right' },
          ],
          rows: report.sites.map((s) => ({ ...s, pct: s.attendancePct == null ? '–' : `${s.attendancePct}%` })),
        });
      }
    }
    return {
      title: titleMap[meta.period] ?? 'Attendance Report',
      fileName: `windguard-${meta.period}-attendance-${meta.from}${meta.to !== meta.from ? `_to_${meta.to}` : ''}`,
      meta: docMeta,
      sections,
      landscape: true,
      signatures: ['Prepared by (Supervisor)', 'Verified by (Site In-charge)', 'Approved by (Company Admin)'],
    };
  }

  // ───────────────────────────── Muster roll ─────────────────────────────

  async muster(user: AuthUser, siteId: string, year: number, month: number) {
    const site = await this.org.site(user, siteId);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const settings = await this.org.settings(user.orgId);
    const abbr = settings.abbreviations as Record<string, string>;
    const start = DateTime.fromObject({ year, month, day: 1 }, { zone: 'utc' });
    const from = start.toISODate()!;
    const to = start.endOf('month').toISODate()!;
    const days = eachDay(from, to);
    const [records, certs] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { siteId, workDate: { gte: dateOnly(from), lte: dateOnly(to) } },
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true, designation: { select: { name: true } }, location: { select: { name: true } } } },
          markedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.musterRoll.findMany({ where: { siteId, year, month }, orderBy: { createdAt: 'desc' } }),
    ]);
    const rank: Record<string, number> = { PRESENT: 9, ON_DUTY: 8, INCOMPLETE: 7, HALF_DAY: 6, LEAVE: 5, HOLIDAY: 4, WEEKLY_OFF: 3, ABSENT: 2, PENDING: 1, NOT_SCHEDULED: 0 };
    const byEmp = new Map<string, { emp: (typeof records)[number]['employee']; days: Record<string, AttendanceStatus>; minutes: number; tally: Tally; keepers: Set<string> }>();
    for (const r of records) {
      let e = byEmp.get(r.employeeId);
      if (!e) {
        e = { emp: r.employee, days: {}, minutes: 0, tally: emptyTally(), keepers: new Set() };
        byEmp.set(r.employeeId, e);
      }
      const k = dateKey(r.workDate);
      // When several shifts fall on one day, the register shows the strongest attendance mark.
      if (!e.days[k] || rank[r.status] > rank[e.days[k]]) e.days[k] = r.status;
      e.minutes += r.workedMinutes ?? 0;
      addToTally(e.tally, r);
      if (r.markedBy) e.keepers.add(r.markedBy.fullName);
    }
    const rows = [...byEmp.values()]
      .sort((a, b) => a.emp.employeeCode.localeCompare(b.emp.employeeCode, undefined, { numeric: true }))
      .map((e, i) => {
        const workingDays = Object.values(e.days).reduce((s, st) => s + dayWeight(st), 0);
        const remarks = [e.tally.absent && `${e.tally.absent} A`, e.tally.leave && `${e.tally.leave} L`, e.tally.halfDay && `${e.tally.halfDay} H`, e.tally.late && `${e.tally.late} late`, e.tally.incomplete && `${e.tally.incomplete} IC`]
          .filter(Boolean)
          .join(', ');
        return {
          serial: i + 1,
          employeeId: e.emp.id,
          employeeCode: e.emp.employeeCode,
          fullName: e.emp.fullName,
          designation: e.emp.designation?.name ?? '',
          location: e.emp.location?.name ?? site.name,
          cells: Object.fromEntries(days.map((d) => [d, e.days[d] ? (abbr[e.days[d]] ?? e.days[d]) : ''])),
          workingDays,
          totalHours: hrs(e.minutes),
          overtimeHours: hrs(e.tally.overtimeMinutes),
          remarks,
          keepers: [...e.keepers],
        };
      });
    return {
      company: org.name,
      site: { id: site.id, name: site.name, code: site.code, district: site.district, state: site.state },
      year,
      month,
      label: start.toFormat('LLLL yyyy'),
      days,
      abbreviations: abbr,
      rows,
      totals: {
        workingDays: rows.reduce((s, r) => s + r.workingDays, 0),
        totalHours: Math.round(rows.reduce((s, r) => s + r.totalHours, 0) * 10) / 10,
      },
      certifications: certs.map((c) => ({ id: c.id, keeperName: c.keeperName, createdAt: c.createdAt, status: c.status })),
    };
  }

  musterDocument(m: Awaited<ReturnType<ReportsService['muster']>>, generatedBy: string): ReportDoc {
    const cert = m.certifications[0];
    return {
      title: 'Muster Roll – Form of Register of Attendance',
      fileName: `windguard-muster-roll-${m.site.code}-${m.year}-${String(m.month).padStart(2, '0')}`,
      meta: [
        { label: 'Company', value: m.company },
        { label: 'Site', value: `${m.site.name} (${m.site.code})${m.site.district ? `, ${m.site.district}` : ''}${m.site.state ? `, ${m.site.state}` : ''}` },
        { label: 'Month', value: m.label },
        { label: 'Generated on', value: DateTime.now().setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm') },
        { label: 'Generated by', value: generatedBy },
        { label: 'Register keeper', value: cert ? `${cert.keeperName} (certified ${DateTime.fromJSDate(cert.createdAt).toFormat('dd LLL yyyy')})` : 'Not yet certified' },
        { label: 'Legend', value: Object.entries(m.abbreviations).filter(([k]) => k !== 'PENDING').map(([k, v]) => `${v}=${STATUS_LABEL[k]}`).join('  ') },
      ],
      sections: [
        {
          name: 'Muster Roll',
          compact: true,
          cellColors: MUSTER_COLORS,
          columns: [
            { key: 'serial', label: 'S.No', width: 3.2, align: 'right' },
            { key: 'employeeCode', label: 'Emp ID', width: 6.5 },
            { key: 'fullName', label: 'Name', width: 15 },
            { key: 'designation', label: 'Designation', width: 9 },
            { key: 'location', label: 'Deployment', width: 9 },
            ...m.days.map((d) => ({ key: d, label: String(Number(d.slice(8))), width: 2.6, align: 'center' as const })),
            { key: 'workingDays', label: 'Days', width: 4, align: 'right' },
            { key: 'totalHours', label: 'Hours', width: 5, align: 'right' },
            { key: 'remarks', label: 'Remarks', width: 10 },
          ],
          rows: m.rows.map((r) => ({ ...r, ...r.cells })),
          totals: { fullName: 'Total', workingDays: m.totals.workingDays, totalHours: m.totals.totalHours },
        },
      ],
      landscape: true,
      signatures: ['Register keeper / Supervisor', 'Site In-charge', 'Authorised Signatory'],
    };
  }
}
