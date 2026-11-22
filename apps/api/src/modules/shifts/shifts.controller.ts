import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, siteScope } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { addDays, dateKey, dateOnly, eachDay, fmtMinute, shiftWindow, todayIn } from '../../common/time';
import { parse, z, zDate, zId } from '../../common/zod';
import { RosterService } from './roster.service';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const toMinute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const shiftSchema = z.object({
  siteId: zId,
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  start: hhmm,
  end: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(180).default(0),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(10),
  requiredWorkers: z.coerce.number().int().min(0).max(500).default(1),
  supervisorId: z.string().nullable().optional(),
  activeDays: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3B82F6'),
  isActive: z.boolean().default(true),
});

export const DEFAULT_SHIFTS = [
  { name: 'First Shift', code: 'S1', startMinute: 360, endMinute: 840, color: '#0F9F8F', sortOrder: 1 },
  { name: 'Second Shift', code: 'S2', startMinute: 840, endMinute: 1320, color: '#2A78D6', sortOrder: 2 },
  { name: 'Third Shift', code: 'S3', startMinute: 1320, endMinute: 360, color: '#EB6834', sortOrder: 3 },
];

@Controller()
export class ShiftsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly roster: RosterService,
    private readonly notify: NotifyService,
  ) {}

  // ───────────── shift definitions ─────────────

  @Get('shifts')
  @Perm('shifts.read')
  async list(@CurrentUser() user: AuthUser, @Query('siteId') siteId?: string) {
    const shifts = await this.prisma.shift.findMany({
      where: { organizationId: user.orgId, ...siteScope(user, siteId) },
      include: { site: { select: { name: true, code: true } }, supervisor: { select: { id: true, fullName: true } }, _count: { select: { defaultFor: true } } },
      orderBy: [{ site: { name: 'asc' } }, { sortOrder: 'asc' }, { startMinute: 'asc' }],
    });
    return shifts.map((s) => ({
      ...s,
      start: fmtMinute(s.startMinute),
      end: fmtMinute(s.endMinute),
      overnight: s.endMinute <= s.startMinute,
      assignedEmployees: s._count.defaultFor,
    }));
  }

  @Post('shifts')
  @Perm('shifts.manage')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(shiftSchema, body);
    await this.org.site(user, p.siteId);
    if (p.start === p.end) throw new BadRequestException('Start and end time cannot be the same');
    const dup = await this.prisma.shift.findUnique({ where: { siteId_code: { siteId: p.siteId, code: p.code } } });
    if (dup) throw new ConflictException(`Shift code ${p.code} already exists at this site`);
    const count = await this.prisma.shift.count({ where: { siteId: p.siteId } });
    const shift = await this.prisma.shift.create({
      data: {
        organizationId: user.orgId,
        siteId: p.siteId,
        name: p.name,
        code: p.code,
        startMinute: toMinute(p.start),
        endMinute: toMinute(p.end),
        breakMinutes: p.breakMinutes,
        graceMinutes: p.graceMinutes,
        requiredWorkers: p.requiredWorkers,
        supervisorId: p.supervisorId || null,
        activeDays: p.activeDays,
        color: p.color,
        isActive: p.isActive,
        sortOrder: count + 1,
      },
    });
    await this.audit.log(user, { action: 'shift.create', entity: 'Shift', entityId: shift.id, after: p });
    return shift;
  }

  @Patch('shifts/:id')
  @Perm('shifts.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const before = await this.org.shift(user, id);
    const p = parse(shiftSchema.partial().omit({ siteId: true }), body);
    const data: Record<string, unknown> = { ...p };
    delete data.start;
    delete data.end;
    if (p.start) data.startMinute = toMinute(p.start);
    if (p.end) data.endMinute = toMinute(p.end);
    if (p.supervisorId === '') data.supervisorId = null;
    const after = await this.prisma.shift.update({ where: { id }, data });
    await this.audit.log(user, { action: 'shift.update', entity: 'Shift', entityId: id, before, after });
    return after;
  }

  @Post('shifts/defaults')
  @HttpCode(200)
  @Perm('shifts.manage')
  async createDefaults(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { siteId } = parse(z.object({ siteId: zId }), body);
    await this.org.site(user, siteId);
    const created = [];
    for (const d of DEFAULT_SHIFTS) {
      const exists = await this.prisma.shift.findUnique({ where: { siteId_code: { siteId, code: d.code } } });
      if (exists) continue;
      created.push(
        await this.prisma.shift.create({
          data: { ...d, organizationId: user.orgId, siteId, breakMinutes: 30, graceMinutes: 10, requiredWorkers: 4 },
        }),
      );
    }
    await this.audit.log(user, { action: 'shift.create_defaults', entity: 'Shift', entityId: siteId, after: { created: created.map((c) => c.code) } });
    return { created: created.length };
  }

  // ───────────── roster ─────────────

  @Get('roster')
  @Perm('roster.read')
  async getRoster(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ siteId: zId, from: zDate, to: zDate }), q);
    const site = await this.org.site(user, p.siteId);
    const days = eachDay(p.from, p.to);
    if (days.length > 42) throw new BadRequestException('Request at most 6 weeks');
    const [shifts, entries] = await Promise.all([
      this.prisma.shift.findMany({ where: { siteId: site.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.rosterEntry.findMany({
        where: { siteId: site.id, workDate: { gte: dateOnly(p.from), lte: dateOnly(p.to) } },
        include: {
          employee: { select: { id: true, employeeCode: true, fullName: true, designation: { select: { name: true } }, status: true } },
          shift: { select: { id: true, startMinute: true, endMinute: true, breakMinutes: true } },
          location: { select: { name: true } },
        },
        orderBy: { employee: { employeeCode: 'asc' } },
      }),
    ]);
    // Overlaps need the neighbouring days too (overnight shifts reach into the next day).
    const overlapIds = this.roster.findOverlaps(entries, site.timezone);
    const cells: Record<string, { date: string; shiftId: string; assigned: number; required: number; understaffed: boolean }> = {};
    for (const d of days) {
      for (const s of shifts) {
        const active = s.activeDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
        cells[`${d}|${s.id}`] = { date: d, shiftId: s.id, assigned: 0, required: active ? s.requiredWorkers : 0, understaffed: false };
      }
    }
    for (const e of entries) {
      const c = cells[`${dateKey(e.workDate)}|${e.shiftId}`];
      if (c) c.assigned++;
    }
    for (const c of Object.values(cells)) c.understaffed = c.assigned < c.required;
    return {
      site: { id: site.id, name: site.name, timezone: site.timezone },
      today: todayIn(site.timezone),
      days,
      shifts: shifts.map((s) => ({ id: s.id, name: s.name, code: s.code, start: fmtMinute(s.startMinute), end: fmtMinute(s.endMinute), color: s.color, requiredWorkers: s.requiredWorkers })),
      entries: entries.map((e) => ({
        id: e.id,
        date: dateKey(e.workDate),
        shiftId: e.shiftId,
        employeeId: e.employeeId,
        employeeCode: e.employee.employeeCode,
        fullName: e.employee.fullName,
        designation: e.employee.designation?.name ?? null,
        location: e.location?.name ?? null,
        overlap: overlapIds.has(e.id),
      })),
      cells: Object.values(cells),
    };
  }

  @Post('roster')
  @HttpCode(200)
  @Perm('roster.manage')
  async assign(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ siteId: zId, shiftId: zId, workDate: zDate, employeeIds: z.array(zId).min(1).max(200), locationId: z.string().nullable().optional() }), body);
    await this.org.shift(user, p.shiftId, p.siteId);
    const emps = await this.prisma.employee.findMany({ where: { id: { in: p.employeeIds }, organizationId: user.orgId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (emps.length !== p.employeeIds.length) throw new BadRequestException('Only active employees can be rostered');
    const res = await this.prisma.rosterEntry.createMany({
      data: p.employeeIds.map((employeeId) => ({
        organizationId: user.orgId,
        siteId: p.siteId,
        shiftId: p.shiftId,
        employeeId,
        workDate: dateOnly(p.workDate),
        locationId: p.locationId ?? null,
        createdById: user.id,
      })),
      skipDuplicates: true,
    });
    await this.audit.log(user, { action: 'roster.assign', entity: 'RosterEntry', entityId: p.shiftId, after: { ...p, created: res.count } });
    return { created: res.count };
  }

  @Patch('roster/:id')
  @Perm('roster.manage')
  async move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { shiftId } = parse(z.object({ shiftId: zId }), body);
    const entry = await this.prisma.rosterEntry.findFirst({ where: { id, organizationId: user.orgId }, include: { employee: true } });
    if (!entry) throw new NotFoundException('Roster entry not found');
    await this.org.shift(user, shiftId, entry.siteId);
    const hasRecord = await this.prisma.attendanceRecord.findFirst({ where: { employeeId: entry.employeeId, shiftId: entry.shiftId, workDate: entry.workDate } });
    if (hasRecord) throw new ConflictException('Attendance is already recorded for this assignment; it cannot be moved');
    const updated = await this.prisma.rosterEntry.update({ where: { id }, data: { shiftId } });
    await this.audit.log(user, { action: 'roster.change_shift', entity: 'RosterEntry', entityId: id, before: { shiftId: entry.shiftId }, after: { shiftId } });
    await this.notify.toSiteSupervisors(user.orgId, entry.siteId, {
      type: 'roster.changed',
      title: 'Employee assignment changed',
      body: `${entry.employee.fullName} moved to a different shift on ${dateKey(entry.workDate)}.`,
      link: '/shifts?tab=roster',
    });
    return updated;
  }

  @Delete('roster/:id')
  @Perm('roster.manage')
  async unassign(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const entry = await this.prisma.rosterEntry.findFirst({ where: { id, organizationId: user.orgId } });
    if (!entry) throw new NotFoundException('Roster entry not found');
    const hasRecord = await this.prisma.attendanceRecord.findFirst({ where: { employeeId: entry.employeeId, shiftId: entry.shiftId, workDate: entry.workDate } });
    if (hasRecord) throw new ConflictException('Attendance is already recorded for this assignment; it cannot be removed');
    await this.prisma.rosterEntry.delete({ where: { id } });
    await this.audit.log(user, { action: 'roster.unassign', entity: 'RosterEntry', entityId: id, before: entry });
    return { ok: true };
  }

  @Post('roster/copy')
  @HttpCode(200)
  @Perm('roster.manage')
  async copy(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ siteId: zId, sourceFrom: zDate, targetFrom: zDate, days: z.union([z.literal(1), z.literal(7)]) }), body);
    await this.org.site(user, p.siteId);
    return this.roster.copyDays(user, p.siteId, p.sourceFrom, p.targetFrom, p.days);
  }

  @Post('roster/generate')
  @HttpCode(200)
  @Perm('roster.manage')
  async generate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ siteId: zId, from: zDate, to: zDate }), body);
    await this.org.site(user, p.siteId);
    const created = await this.roster.generateFromDefaults(user.orgId, p.siteId, p.from, p.to, user.id);
    await this.audit.log(user, { action: 'roster.generate', entity: 'RosterEntry', entityId: p.siteId, after: { ...p, created } });
    return { created };
  }

  // ───────────── handovers ─────────────

  @Get('handovers')
  @Perm('attendance.read')
  async handovers(@CurrentUser() user: AuthUser, @Query('siteId') siteId?: string) {
    return this.prisma.shiftHandover.findMany({
      where: { organizationId: user.orgId, ...siteScope(user, siteId) },
      include: { site: { select: { name: true } }, shift: { select: { name: true, code: true } } },
      orderBy: { handoverAt: 'desc' },
      take: 100,
    });
  }

  @Post('handovers')
  @Perm('handover.write')
  async createHandover(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        siteId: zId,
        shiftId: zId,
        workDate: zDate,
        incomingSupervisorId: z.string().nullable().optional(),
        remarks: z.string().max(2000).optional().nullable(),
        pendingIssues: z.string().max(2000).optional().nullable(),
      }),
      body,
    );
    const site = await this.org.site(user, p.siteId);
    const shift = await this.org.shift(user, p.shiftId, p.siteId);
    const [entries, records] = await Promise.all([
      this.prisma.rosterEntry.findMany({ where: { shiftId: p.shiftId, workDate: dateOnly(p.workDate) }, include: { employee: { select: { employeeCode: true, fullName: true } } } }),
      this.prisma.attendanceRecord.findMany({ where: { shiftId: p.shiftId, workDate: dateOnly(p.workDate) } }),
    ]);
    const recMap = new Map(records.map((r) => [r.employeeId, r]));
    const present: { code: string; name: string; status: string }[] = [];
    const missing: { code: string; name: string; status: string }[] = [];
    for (const e of entries) {
      const r = recMap.get(e.employeeId);
      const item = { code: e.employee.employeeCode, name: e.employee.fullName, status: r?.status ?? 'PENDING' };
      if (r && ['PRESENT', 'ON_DUTY', 'HALF_DAY', 'INCOMPLETE'].includes(r.status)) present.push(item);
      else missing.push(item);
    }
    let incomingName: string | null = null;
    if (p.incomingSupervisorId) {
      const inc = await this.prisma.user.findFirst({ where: { id: p.incomingSupervisorId, organizationId: user.orgId } });
      if (!inc) throw new BadRequestException('Incoming supervisor not found');
      incomingName = inc.fullName;
    }
    const h = await this.prisma.shiftHandover.create({
      data: {
        organizationId: user.orgId,
        siteId: site.id,
        shiftId: shift.id,
        workDate: dateOnly(p.workDate),
        outgoingSupervisorId: user.id,
        outgoingName: user.fullName,
        incomingSupervisorId: p.incomingSupervisorId ?? null,
        incomingName,
        presentCount: present.length,
        presentEmployees: present,
        missingEmployees: missing,
        remarks: p.remarks ?? null,
        pendingIssues: p.pendingIssues ?? null,
      },
    });
    await this.audit.log(user, { action: 'handover.create', entity: 'ShiftHandover', entityId: h.id, after: { site: site.name, shift: shift.name, workDate: p.workDate, present: present.length, missing: missing.length } });
    if (p.incomingSupervisorId) {
      await this.notify.toUsers(user.orgId, [p.incomingSupervisorId], {
        type: 'handover.pending',
        title: 'Shift handover awaiting your confirmation',
        body: `${user.fullName} handed over ${shift.name} at ${site.name} (${present.length} present, ${missing.length} missing).`,
        link: '/shifts?tab=handover',
        severity: 'WARNING',
        dedupeKey: `handover:${h.id}`,
      });
    }
    return h;
  }

  @Post('handovers/:id/confirm')
  @HttpCode(200)
  @Perm('handover.write')
  async confirmHandover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const h = await this.prisma.shiftHandover.findFirst({ where: { id, organizationId: user.orgId } });
    if (!h) throw new NotFoundException('Handover not found');
    if (h.status === 'CONFIRMED') throw new ConflictException('Already confirmed');
    if (h.outgoingSupervisorId === user.id) throw new BadRequestException('The outgoing supervisor cannot confirm their own handover');
    if (h.incomingSupervisorId && h.incomingSupervisorId !== user.id && user.role === 'SUPERVISOR') {
      throw new BadRequestException('Only the incoming supervisor can confirm this handover');
    }
    const updated = await this.prisma.shiftHandover.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), incomingSupervisorId: h.incomingSupervisorId ?? user.id, incomingName: h.incomingName ?? user.fullName },
    });
    await this.audit.log(user, { action: 'handover.confirm', entity: 'ShiftHandover', entityId: id, after: { status: 'CONFIRMED' } });
    return updated;
  }

  /** Windows for a shift on a date — used by the UI to show "ends next day" correctly. */
  @Get('shifts/:id/window')
  @Perm('shifts.read')
  async window(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('date') date: string) {
    const shift = await this.org.shift(user, id);
    const site = await this.org.site(user, shift.siteId);
    const d = parse(zDate, date);
    return { ...shiftWindow(d, shift, site.timezone), nextDay: addDays(d, 1) };
  }
}
