import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, siteScope } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { Perm, Public } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { dateKey, dateOnly, fmtLocal, todayIn } from '../../common/time';
import { parse, z, zDate, zId } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';
import { ExportService } from '../reports/export.service';

const VISITOR_TYPES = ['VISITOR', 'VENDOR', 'CONTRACTOR', 'OFFICIAL', 'DELIVERY', 'OEM_ENGINEER'] as const;

@Controller()
export class MiscController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly notify: NotifyService,
    private readonly exporter: ExportService,
  ) {}

  // ───────────── audit logs ─────────────

  @Get('audit')
  @Perm('audit.read')
  async auditLogs(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(
      z.object({
        entity: z.string().optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        entityId: z.string().optional(),
        from: zDate.optional(),
        to: zDate.optional(),
        search: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      q,
    );
    const where: Prisma.AuditLogWhereInput = {
      organizationId: user.orgId,
      ...(p.entity ? { entity: p.entity } : {}),
      ...(p.action ? { action: { startsWith: p.action } } : {}),
      ...(p.userId ? { userId: p.userId } : {}),
      ...(p.entityId ? { entityId: p.entityId } : {}),
      ...(p.from || p.to
        ? { createdAt: { ...(p.from ? { gte: new Date(`${p.from}T00:00:00+05:30`) } : {}), ...(p.to ? { lte: new Date(`${p.to}T23:59:59+05:30`) } : {}) } }
        : {}),
      ...(p.search ? { OR: [{ userName: { contains: p.search, mode: 'insensitive' } }, { action: { contains: p.search, mode: 'insensitive' } }, { reason: { contains: p.search, mode: 'insensitive' } }] } : {}),
    };
    const [total, items, entities] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
      this.prisma.auditLog.groupBy({ by: ['entity'], where: { organizationId: user.orgId }, _count: true }),
    ]);
    return { total, items, entities: entities.map((e) => ({ entity: e.entity, count: e._count })) };
  }

  // ───────────── notifications ─────────────

  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id, organizationId: user.orgId, ...(unread === 'true' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({ where: { userId: user.id, organizationId: user.orgId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  @Get('push/key')
  pushKey() {
    return { publicKey: this.notify.pushPublicKey };
  }

  @Post('push/subscribe')
  @HttpCode(200)
  async subscribe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }), body);
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: p.endpoint },
      create: { userId: user.id, endpoint: p.endpoint, p256dh: p.keys.p256dh, auth: p.keys.auth, userAgent: user.userAgent?.slice(0, 200) },
      update: { userId: user.id, p256dh: p.keys.p256dh, auth: p.keys.auth },
    });
    return { ok: true };
  }

  @Post('push/unsubscribe')
  @HttpCode(200)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { endpoint } = parse(z.object({ endpoint: z.string() }), body);
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    return { ok: true };
  }

  // ───────────── organization settings ─────────────

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser) {
    const [settings, org] = await Promise.all([this.org.settings(user.orgId), this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } })]);
    return { settings, organization: org };
  }

  @Patch('settings')
  @Perm('settings.manage')
  async updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        employeeIdPrefix: z.string().regex(/^[A-Z]{1,6}$/, '1–6 capital letters').optional(),
        employeeIdPadding: z.number().int().min(3).max(8).optional(),
        overtimeEnabled: z.boolean().optional(),
        overtimeThresholdMins: z.number().int().min(0).max(240).optional(),
        halfDayThresholdMins: z.number().int().min(60).max(600).optional(),
        incompleteAfterHours: z.number().int().min(1).max(12).optional(),
        countLeaveInPercentage: z.boolean().optional(),
        requireRegisterApproval: z.boolean().optional(),
        abbreviations: z.record(z.string(), z.string().trim().min(1).max(3)).optional(),
      }),
      body,
    );
    const before = await this.org.settings(user.orgId);
    if (p.abbreviations) {
      const values = Object.values(p.abbreviations);
      if (new Set(values).size !== values.length) throw new BadRequestException('Each status needs a unique abbreviation');
      p.abbreviations = { ...(before.abbreviations as Record<string, string>), ...p.abbreviations };
    }
    const after = await this.prisma.organizationSettings.update({ where: { organizationId: user.orgId }, data: p });
    await this.audit.log(user, { action: 'settings.update', entity: 'OrganizationSettings', entityId: user.orgId, before, after });
    return after;
  }

  // ───────────── holidays & weekly offs ─────────────

  @Get('holidays')
  async holidays(@CurrentUser() user: AuthUser, @Query('year') year?: string) {
    const y = Number(year) || DateTime.now().year;
    return this.prisma.holiday.findMany({
      where: { organizationId: user.orgId, date: { gte: dateOnly(`${y}-01-01`), lte: dateOnly(`${y}-12-31`) } },
      include: { site: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });
  }

  @Post('holidays')
  @Perm('settings.manage')
  async addHoliday(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ date: zDate, name: z.string().trim().min(2).max(80), siteId: z.string().nullable().optional() }), body);
    if (p.siteId) await this.org.site(user, p.siteId);
    const exists = await this.prisma.holiday.findFirst({ where: { organizationId: user.orgId, date: dateOnly(p.date), siteId: p.siteId ?? null } });
    if (exists) throw new ConflictException('A holiday already exists on this date');
    const h = await this.prisma.holiday.create({ data: { organizationId: user.orgId, date: dateOnly(p.date), name: p.name, siteId: p.siteId ?? null } });
    await this.audit.log(user, { action: 'holiday.create', entity: 'Holiday', entityId: h.id, after: p });
    return h;
  }

  @Delete('holidays/:id')
  @Perm('settings.manage')
  async deleteHoliday(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: user.orgId } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log(user, { action: 'holiday.delete', entity: 'Holiday', entityId: id, before: h });
    return { ok: true };
  }

  // ───────────── leave records ─────────────

  @Get('leave')
  @Perm('employees.read')
  async leave(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ employeeId: z.string().optional(), from: zDate.optional(), siteId: z.string().optional() }), q);
    return this.prisma.leaveRecord.findMany({
      where: {
        organizationId: user.orgId,
        ...(p.employeeId ? { employeeId: p.employeeId } : {}),
        ...(p.from ? { endDate: { gte: dateOnly(p.from) } } : {}),
        ...(p.siteId || user.siteIds ? { employee: siteScope(user, p.siteId) } : {}),
      },
      include: { employee: { select: { employeeCode: true, fullName: true, site: { select: { name: true } } } } },
      orderBy: { startDate: 'desc' },
      take: 200,
    });
  }

  @Post('leave')
  @Perm('employees.write')
  async addLeave(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({ employeeId: zId, startDate: zDate, endDate: zDate, leaveType: z.enum(['CASUAL', 'SICK', 'EARNED', 'UNPAID', 'COMPENSATORY']), reason: z.string().max(300).optional().nullable() }),
      body,
    );
    if (p.endDate < p.startDate) throw new BadRequestException('End date must be on or after the start date');
    await this.org.employee(user, p.employeeId);
    const overlap = await this.prisma.leaveRecord.findFirst({
      where: { employeeId: p.employeeId, status: 'APPROVED', startDate: { lte: dateOnly(p.endDate) }, endDate: { gte: dateOnly(p.startDate) } },
    });
    if (overlap) throw new ConflictException('Overlaps an existing approved leave');
    const l = await this.prisma.leaveRecord.create({
      data: { organizationId: user.orgId, employeeId: p.employeeId, startDate: dateOnly(p.startDate), endDate: dateOnly(p.endDate), leaveType: p.leaveType, reason: p.reason ?? null, recordedById: user.id },
    });
    await this.audit.log(user, { action: 'leave.create', entity: 'LeaveRecord', entityId: l.id, after: p });
    return l;
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @Perm('employees.write')
  async cancelLeave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const l = await this.prisma.leaveRecord.findFirst({ where: { id, organizationId: user.orgId } });
    if (!l) throw new NotFoundException('Leave not found');
    await this.prisma.leaveRecord.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(user, { action: 'leave.cancel', entity: 'LeaveRecord', entityId: id, before: { status: l.status }, after: { status: 'CANCELLED' } });
    return { ok: true };
  }

  // ───────────── gate entry register ─────────────

  @Get('gate')
  @Perm('gate.read')
  async gate(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ siteId: z.string().optional(), date: zDate.optional(), from: zDate.optional(), to: zDate.optional(), onSite: z.string().optional(), search: z.string().optional() }), q);
    return this.prisma.gateEntry.findMany({
      where: this.gateWhere(user, p),
      include: { site: { select: { name: true, code: true, timezone: true } } },
      orderBy: { entryAt: 'desc' },
      take: 500,
    });
  }

  private gateWhere(user: AuthUser, p: { siteId?: string; date?: string; from?: string; to?: string; onSite?: string; search?: string }): Prisma.GateEntryWhereInput {
    const from = p.date ?? p.from;
    const to = p.date ?? p.to;
    return {
      organizationId: user.orgId,
      ...siteScope(user, p.siteId),
      ...(from || to
        ? { entryAt: { ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}) } }
        : {}),
      ...(p.onSite === 'true' ? { exitAt: null } : {}),
      ...(p.search
        ? { OR: [{ visitorName: { contains: p.search, mode: 'insensitive' } }, { vehicleNumber: { contains: p.search, mode: 'insensitive' } }, { company: { contains: p.search, mode: 'insensitive' } }] }
        : {}),
    };
  }

  @Post('gate')
  @Perm('gate.write')
  async addGate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        siteId: zId,
        visitorName: z.string().trim().min(2).max(120),
        company: z.string().max(120).optional().nullable(),
        visitorType: z.enum(VISITOR_TYPES),
        mobile: z.string().regex(/^(\+?\d{1,3}[\s-]?)?\d{10}$/, 'Enter a 10-digit mobile number').optional().nullable().or(z.literal('')),
        purpose: z.string().trim().min(2).max(200),
        vehicleNumber: z.string().max(20).optional().nullable().transform((v) => (v ? v.toUpperCase().replace(/\s+/g, ' ').trim() : null)),
        personToMeet: z.string().max(120).optional().nullable(),
        entryAt: z.string().optional().nullable(),
        remarks: z.string().max(300).optional().nullable(),
      }),
      body,
    );
    await this.org.site(user, p.siteId);
    const entryAt = p.entryAt ? new Date(p.entryAt) : new Date();
    if (Number.isNaN(entryAt.getTime()) || entryAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Invalid entry time');
    const g = await this.prisma.gateEntry.create({
      data: { ...p, mobile: p.mobile || null, entryAt, organizationId: user.orgId, recordedById: user.id, recordedByName: user.fullName },
    });
    await this.audit.log(user, { action: 'gate.entry', entity: 'GateEntry', entityId: g.id, after: { ...p, mobile: p.mobile ? '••••' + p.mobile.slice(-4) : null } });
    return g;
  }

  @Post('gate/:id/exit')
  @HttpCode(200)
  @Perm('gate.write')
  async gateExit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { exitAt, remarks } = parse(z.object({ exitAt: z.string().optional().nullable(), remarks: z.string().max(300).optional().nullable() }), body ?? {});
    const g = await this.prisma.gateEntry.findFirst({ where: { id, organizationId: user.orgId, ...siteScope(user) } });
    if (!g) throw new NotFoundException('Entry not found');
    if (g.exitAt) throw new ConflictException('Exit already recorded');
    const at = exitAt ? new Date(exitAt) : new Date();
    if (at < g.entryAt) throw new BadRequestException('Exit must be after entry');
    const updated = await this.prisma.gateEntry.update({ where: { id }, data: { exitAt: at, remarks: remarks ?? g.remarks } });
    await this.audit.log(user, { action: 'gate.exit', entity: 'GateEntry', entityId: id, after: { exitAt: at } });
    return updated;
  }

  @Get('gate/report')
  @Perm('gate.read')
  async gateReport(@CurrentUser() user: AuthUser, @Query() q: unknown, @Res() res: Response) {
    const p = parse(z.object({ siteId: z.string().optional(), from: zDate, to: zDate, format: z.enum(['xlsx', 'csv', 'pdf']) }), q);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const site = p.siteId ? await this.org.site(user, p.siteId) : null;
    const rows = await this.prisma.gateEntry.findMany({ where: this.gateWhere(user, p), include: { site: true }, orderBy: { entryAt: 'asc' } });
    const tz = site?.timezone ?? org.timezone;
    const stay = (a: Date, b: Date | null) => (b ? `${Math.floor((b.getTime() - a.getTime()) / 3600000)}h ${Math.round(((b.getTime() - a.getTime()) % 3600000) / 60000)}m` : 'On site');
    await this.prisma.exportJob.create({ data: { organizationId: user.orgId, createdById: user.id, createdByName: user.fullName, reportType: 'gate-register', format: p.format, filters: p, rowCount: rows.length } });
    await this.audit.log(user, { action: 'report.export', entity: 'Report', entityId: 'gate-register', after: { ...p, rowCount: rows.length } });
    await this.exporter.send(
      res,
      {
        title: 'Gate Entry Register',
        fileName: `windguard-gate-register-${p.from}_to_${p.to}`,
        landscape: true,
        meta: [
          { label: 'Company', value: org.name },
          { label: 'Site', value: site ? `${site.name} (${site.code})` : 'All sites' },
          { label: 'Period', value: `${p.from} to ${p.to}` },
          { label: 'Generated by', value: user.fullName },
          { label: 'Entries', value: `${rows.length} (${rows.filter((r) => r.vehicleNumber).length} with vehicles)` },
        ],
        sections: [
          {
            name: 'Gate Movements',
            columns: [
              { key: 'sl', label: 'S.No', width: 4, align: 'right' },
              { key: 'date', label: 'Date', width: 8 },
              { key: 'visitorName', label: 'Visitor', width: 14 },
              { key: 'company', label: 'Company', width: 13 },
              { key: 'visitorType', label: 'Type', width: 9 },
              { key: 'mobile', label: 'Mobile', width: 10 },
              { key: 'purpose', label: 'Purpose', width: 16 },
              { key: 'vehicleNumber', label: 'Vehicle', width: 10 },
              { key: 'personToMeet', label: 'To Meet', width: 11 },
              { key: 'in', label: 'In', width: 6 },
              { key: 'out', label: 'Out', width: 6 },
              { key: 'stay', label: 'Duration', width: 8 },
              { key: 'recordedByName', label: 'Recorded By', width: 11 },
            ],
            rows: rows.map((r, i) => ({
              ...r,
              sl: i + 1,
              date: fmtLocal(r.entryAt, tz, 'dd-MM-yyyy'),
              in: fmtLocal(r.entryAt, tz, 'HH:mm'),
              out: fmtLocal(r.exitAt, tz, 'HH:mm'),
              stay: stay(r.entryAt, r.exitAt),
            })),
          },
        ],
        signatures: ['Security Supervisor', 'Site In-charge'],
      },
      p.format,
    );
  }

  @Get('gate/summary')
  @Perm('gate.read')
  async gateSummary(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ siteId: z.string().optional(), from: zDate, to: zDate }), q);
    const rows = await this.prisma.gateEntry.findMany({ where: this.gateWhere(user, p), select: { entryAt: true, exitAt: true, visitorType: true, vehicleNumber: true } });
    const byDay = new Map<string, { entries: number; vehicles: number }>();
    const byType: Record<string, number> = {};
    for (const r of rows) {
      const d = DateTime.fromJSDate(r.entryAt).setZone('Asia/Kolkata').toISODate()!;
      const x = byDay.get(d) ?? { entries: 0, vehicles: 0 };
      x.entries++;
      if (r.vehicleNumber) x.vehicles++;
      byDay.set(d, x);
      byType[r.visitorType] = (byType[r.visitorType] ?? 0) + 1;
    }
    return {
      total: rows.length,
      onSite: rows.filter((r) => !r.exitAt).length,
      vehicles: rows.filter((r) => r.vehicleNumber).length,
      byType,
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    };
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString(), today: todayIn('Asia/Kolkata'), dateKey: dateKey(new Date()) };
  }
}
