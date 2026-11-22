import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/context';
import { DEFAULT_ABBREVIATIONS, OrgService } from '../../common/org.service';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { addDays, dateOnly, todayIn } from '../../common/time';
import { parse, z, zDate, zId } from '../../common/zod';
import { addToTally, attendancePct, emptyTally } from '../attendance/attendance.engine';
import { DEFAULT_SHIFTS } from '../shifts/shifts.controller';

const siteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(16).transform((s) => s.toUpperCase()),
  projectId: z.string().nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  district: z.string().max(60).nullable().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  isActive: z.boolean().default(true),
  createDefaultShifts: z.boolean().optional(),
});

@Controller()
export class SitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  // ───────────── organizations (super admin) ─────────────

  @Get('organizations')
  @Perm('organizations.manage')
  async orgs() {
    const orgs = await this.prisma.organization.findMany({
      include: { _count: { select: { sites: true, employees: true, users: true } } },
      orderBy: { name: 'asc' },
    });
    return orgs;
  }

  @Post('organizations')
  @Perm('organizations.manage')
  async createOrg(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        code: z.string().trim().min(2).max(16).transform((s) => s.toUpperCase()),
        legalName: z.string().max(200).nullable().optional(),
        address: z.string().max(300).nullable().optional(),
        timezone: z.string().default('Asia/Kolkata'),
      }),
      body,
    );
    if (await this.prisma.organization.findUnique({ where: { code: p.code } })) throw new ConflictException('Organization code already exists');
    const org = await this.prisma.organization.create({
      data: { ...p, settings: { create: { abbreviations: DEFAULT_ABBREVIATIONS } } },
    });
    await this.audit.log(user, { orgId: org.id, action: 'organization.create', entity: 'Organization', entityId: org.id, after: p });
    return org;
  }

  @Patch('organizations/:id')
  @Perm('organizations.manage')
  async updateOrg(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        legalName: z.string().max(200).nullable().optional(),
        address: z.string().max(300).nullable().optional(),
        timezone: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      body,
    );
    const before = await this.prisma.organization.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Organization not found');
    const after = await this.prisma.organization.update({ where: { id }, data: p });
    await this.audit.log(user, { orgId: id, action: 'organization.update', entity: 'Organization', entityId: id, before, after });
    return after;
  }

  // ───────────── projects ─────────────

  @Get('projects')
  @Perm('sites.read')
  projects(@CurrentUser() user: AuthUser) {
    return this.prisma.project.findMany({
      where: { organizationId: user.orgId },
      include: { _count: { select: { sites: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post('projects')
  @Perm('sites.manage')
  async createProject(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        code: z.string().trim().min(2).max(16).transform((s) => s.toUpperCase()),
        description: z.string().max(500).nullable().optional(),
        capacityMw: z.coerce.number().min(0).max(100000).nullable().optional(),
      }),
      body,
    );
    if (await this.prisma.project.findUnique({ where: { organizationId_code: { organizationId: user.orgId, code: p.code } } })) {
      throw new ConflictException('Project code already exists');
    }
    const project = await this.prisma.project.create({ data: { ...p, organizationId: user.orgId } });
    await this.audit.log(user, { action: 'project.create', entity: 'Project', entityId: project.id, after: p });
    return project;
  }

  @Patch('projects/:id')
  @Perm('sites.manage')
  async updateProject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        capacityMw: z.coerce.number().min(0).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
      body,
    );
    const before = await this.prisma.project.findFirst({ where: { id, organizationId: user.orgId } });
    if (!before) throw new NotFoundException('Project not found');
    const after = await this.prisma.project.update({ where: { id }, data: p });
    await this.audit.log(user, { action: 'project.update', entity: 'Project', entityId: id, before, after });
    return after;
  }

  // ───────────── sites ─────────────

  @Get('sites')
  @Perm('sites.read')
  async sites(@CurrentUser() user: AuthUser) {
    const sites = await this.prisma.site.findMany({
      where: { organizationId: user.orgId, ...(user.siteIds ? { id: { in: user.siteIds } } : {}) },
      include: {
        project: { select: { id: true, name: true, code: true } },
        supervisors: { include: { user: { select: { id: true, fullName: true, isActive: true } } } },
        shifts: { where: { isActive: true }, select: { id: true, name: true, code: true, requiredWorkers: true, color: true } },
        locations: { select: { id: true, name: true, kind: true, isActive: true } },
        _count: { select: { employees: { where: { status: 'ACTIVE', deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
    if (!sites.length) return [];
    // Today's attendance per site (each site in its own timezone)
    const stats = await Promise.all(
      sites.map(async (s) => {
        const today = todayIn(s.timezone);
        const recs = await this.prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: { siteId: s.id, workDate: dateOnly(today) },
          _count: true,
        });
        const rostered = await this.prisma.rosterEntry.count({ where: { siteId: s.id, workDate: dateOnly(today) } });
        const by = Object.fromEntries(recs.map((r) => [r.status, r._count]));
        return { today, rostered, ...by };
      }),
    );
    return sites.map((s, i) => ({
      ...s,
      activeEmployees: s._count.employees,
      requiredPerDay: s.shifts.reduce((a, b) => a + b.requiredWorkers, 0),
      todayStats: stats[i],
    }));
  }

  @Get('sites/compare')
  @Perm('reports.read')
  async compare(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ from: zDate, to: zDate }), q);
    const settings = await this.org.settings(user.orgId);
    const sites = await this.prisma.site.findMany({
      where: { organizationId: user.orgId, isActive: true, ...(user.siteIds ? { id: { in: user.siteIds } } : {}) },
      select: { id: true, name: true, code: true },
    });
    const recs = await this.prisma.attendanceRecord.findMany({
      where: { organizationId: user.orgId, siteId: { in: sites.map((s) => s.id) }, workDate: { gte: dateOnly(p.from), lte: dateOnly(p.to) } },
      select: { siteId: true, status: true, workedMinutes: true, overtimeMinutes: true, isLate: true },
    });
    const tallies = new Map(sites.map((s) => [s.id, emptyTally()]));
    for (const r of recs) addToTally(tallies.get(r.siteId)!, r);
    return sites.map((s) => {
      const t = tallies.get(s.id)!;
      return { ...s, ...t, attendancePct: attendancePct(t, settings.countLeaveInPercentage) };
    });
  }

  @Get('sites/:id')
  @Perm('sites.read')
  async site(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const site = await this.org.site(user, id);
    const today = todayIn(site.timezone);
    const from = addDays(today, -29);
    const settings = await this.org.settings(user.orgId);
    const [full, recs, todayRecs, rosterToday] = await Promise.all([
      this.prisma.site.findUniqueOrThrow({
        where: { id },
        include: {
          project: true,
          locations: { orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } },
          supervisors: { include: { user: { select: { id: true, fullName: true, email: true, phone: true, isActive: true, lastLoginAt: true } } } },
          shifts: { orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }], include: { supervisor: { select: { fullName: true } } } },
          _count: { select: { employees: { where: { status: 'ACTIVE', deletedAt: null } } } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { siteId: id, workDate: { gte: dateOnly(from), lte: dateOnly(today) } },
        select: { workDate: true, status: true, workedMinutes: true, overtimeMinutes: true, isLate: true },
      }),
      this.prisma.attendanceRecord.groupBy({ by: ['shiftId', 'status'], where: { siteId: id, workDate: dateOnly(today) }, _count: true }),
      this.prisma.rosterEntry.groupBy({ by: ['shiftId'], where: { siteId: id, workDate: dateOnly(today) }, _count: true }),
    ]);
    const byDay = new Map<string, ReturnType<typeof emptyTally>>();
    const total = emptyTally();
    for (const r of recs) {
      const k = r.workDate.toISOString().slice(0, 10);
      if (!byDay.has(k)) byDay.set(k, emptyTally());
      addToTally(byDay.get(k)!, r);
      addToTally(total, r);
    }
    const trend = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, t]) => ({ date, present: t.present + t.onDuty + t.incomplete, absent: t.absent, leave: t.leave, halfDay: t.halfDay, pct: attendancePct(t, settings.countLeaveInPercentage) }));
    return {
      ...full,
      today,
      activeEmployees: full._count.employees,
      last30: { ...total, attendancePct: attendancePct(total, settings.countLeaveInPercentage) },
      trend,
      todayByShift: full.shifts.map((s) => ({
        shiftId: s.id,
        name: s.name,
        required: s.requiredWorkers,
        rostered: rosterToday.find((r) => r.shiftId === s.id)?._count ?? 0,
        statuses: Object.fromEntries(todayRecs.filter((t) => t.shiftId === s.id).map((t) => [t.status, t._count])),
      })),
    };
  }

  @Post('sites')
  @Perm('sites.manage')
  async createSite(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(siteSchema, body);
    if (await this.prisma.site.findUnique({ where: { organizationId_code: { organizationId: user.orgId, code: p.code } } })) {
      throw new ConflictException('Site code already exists');
    }
    if (p.projectId && !(await this.prisma.project.findFirst({ where: { id: p.projectId, organizationId: user.orgId } }))) {
      throw new BadRequestException('Project not found');
    }
    const { createDefaultShifts, ...data } = p;
    const site = await this.prisma.site.create({ data: { ...data, projectId: data.projectId || null, organizationId: user.orgId } });
    if (createDefaultShifts !== false) {
      await this.prisma.shift.createMany({
        data: DEFAULT_SHIFTS.map((d) => ({ ...d, organizationId: user.orgId, siteId: site.id, breakMinutes: 30, graceMinutes: 10, requiredWorkers: 4 })),
      });
    }
    await this.audit.log(user, { action: 'site.create', entity: 'Site', entityId: site.id, after: p });
    return site;
  }

  @Patch('sites/:id')
  @Perm('sites.manage')
  async updateSite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const before = await this.org.site(user, id);
    const p = parse(siteSchema.partial().omit({ code: true, createDefaultShifts: true }), body);
    const after = await this.prisma.site.update({ where: { id }, data: { ...p, projectId: p.projectId === undefined ? undefined : p.projectId || null } });
    await this.audit.log(user, { action: 'site.update', entity: 'Site', entityId: id, before, after });
    return after;
  }

  // ───────────── locations / deployment points ─────────────

  @Post('sites/:id/locations')
  @Perm('sites.manage')
  async addLocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    await this.org.site(user, id);
    const p = parse(z.object({ name: z.string().trim().min(2).max(80), kind: z.string().max(40).default('DEPLOYMENT_POINT') }), body);
    if (await this.prisma.location.findUnique({ where: { siteId_name: { siteId: id, name: p.name } } })) throw new ConflictException('Location already exists');
    const loc = await this.prisma.location.create({ data: { ...p, siteId: id } });
    await this.audit.log(user, { action: 'location.create', entity: 'Location', entityId: loc.id, after: p });
    return loc;
  }

  @Patch('locations/:id')
  @Perm('sites.manage')
  async updateLocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const loc = await this.prisma.location.findFirst({ where: { id, site: { organizationId: user.orgId } } });
    if (!loc) throw new NotFoundException('Location not found');
    const p = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), kind: z.string().max(40).optional(), isActive: z.boolean().optional() }), body);
    const after = await this.prisma.location.update({ where: { id }, data: p });
    await this.audit.log(user, { action: 'location.update', entity: 'Location', entityId: id, before: loc, after });
    return after;
  }

  @Delete('locations/:id')
  @HttpCode(200)
  @Perm('sites.manage')
  async deleteLocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const loc = await this.prisma.location.findFirst({ where: { id, site: { organizationId: user.orgId } }, include: { _count: { select: { employees: true, rosterEntries: true } } } });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc._count.employees || loc._count.rosterEntries) {
      await this.prisma.location.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(user, { action: 'location.deactivate', entity: 'Location', entityId: id, before: loc });
      return { deactivated: true };
    }
    await this.prisma.location.delete({ where: { id } });
    await this.audit.log(user, { action: 'location.delete', entity: 'Location', entityId: id, before: loc });
    return { deleted: true };
  }

  // ───────────── lookups for forms & filters ─────────────

  @Get('lookups')
  async lookups(@CurrentUser() user: AuthUser) {
    const [sites, projects, shifts, designations, departments, supervisors, locations] = await Promise.all([
      this.prisma.site.findMany({
        where: { organizationId: user.orgId, ...(user.siteIds ? { id: { in: user.siteIds } } : {}) },
        select: { id: true, name: true, code: true, timezone: true, projectId: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.project.findMany({ where: { organizationId: user.orgId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      this.prisma.shift.findMany({
        where: { organizationId: user.orgId, ...(user.siteIds ? { siteId: { in: user.siteIds } } : {}) },
        select: { id: true, name: true, code: true, siteId: true, startMinute: true, endMinute: true, color: true, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.designation.findMany({ where: { organizationId: user.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { organizationId: user.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({
        where: { organizationId: user.orgId, role: 'SUPERVISOR', isActive: true },
        select: { id: true, fullName: true, siteAssignments: { select: { siteId: true } } },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.location.findMany({
        where: { site: { organizationId: user.orgId }, isActive: true },
        select: { id: true, name: true, siteId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      sites,
      projects,
      shifts,
      designations,
      departments,
      supervisors: supervisors.map((s) => ({ id: s.id, fullName: s.fullName, siteIds: s.siteAssignments.map((a) => a.siteId) })),
      locations,
    };
  }
}
