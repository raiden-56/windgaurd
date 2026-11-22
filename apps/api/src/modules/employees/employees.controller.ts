import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { addDays, dateKey, dateOnly, todayIn } from '../../common/time';
import { parse, z, zDate } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';
import { addToTally, attendancePct, emptyTally } from '../attendance/attendance.engine';
import { EmployeesService } from './employees.service';

const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'] as const;
const TYPES = ['PERMANENT', 'CONTRACT', 'TEMPORARY', 'TRAINEE'] as const;
export const PHONE_RE = /^(\+?\d{1,3}[\s-]?)?\d{10}$/;

const empSchema = z.object({
  employeeCode: z.string().trim().max(20).regex(/^[A-Za-z0-9\-_/]+$/, 'Letters, digits, - _ / only').optional().nullable(),
  fullName: z.string().trim().min(2, 'Name is required').max(120),
  phone: z.string().trim().regex(PHONE_RE, 'Enter a 10-digit mobile number').optional().nullable().or(z.literal('')),
  address: z.string().max(300).optional().nullable(),
  dateOfBirth: zDate.optional().nullable().or(z.literal('')),
  emergencyContact: z.string().max(120).optional().nullable(),
  designation: z.string().max(80).optional().nullable(),
  department: z.string().max(80).optional().nullable(),
  joiningDate: zDate.optional().nullable().or(z.literal('')),
  employmentType: z.enum(TYPES).default('CONTRACT'),
  status: z.enum(STATUSES).default('ACTIVE'),
  siteId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  defaultShiftId: z.string().optional().nullable(),
  weeklyOffDay: z.number().int().min(0).max(6).optional().nullable(),
  remarks: z.string().max(1000).optional().nullable(),
  photoUrl: z.string().max(400_000).optional().nullable(),
});

const SORTS: Record<string, (dir: 'asc' | 'desc') => Prisma.EmployeeOrderByWithRelationInput> = {
  employeeCode: (d) => ({ employeeCode: d }),
  fullName: (d) => ({ fullName: d }),
  joiningDate: (d) => ({ joiningDate: d }),
  status: (d) => ({ status: d }),
  site: (d) => ({ site: { name: d } }),
  designation: (d) => ({ designation: { name: d } }),
};

@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly svc: EmployeesService,
    private readonly notify: NotifyService,
  ) {}

  static listWhere(user: AuthUser, q: { search?: string; siteId?: string; status?: string; designationId?: string; departmentId?: string; shiftId?: string; type?: string }) {
    const where: Prisma.EmployeeWhereInput = { organizationId: user.orgId, deletedAt: null };
    if (user.siteIds) where.siteId = { in: user.siteIds };
    if (q.siteId) where.siteId = user.siteIds && !user.siteIds.includes(q.siteId) ? '__none__' : q.siteId;
    if (q.status) where.status = q.status as any;
    if (q.designationId) where.designationId = q.designationId;
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.shiftId) where.defaultShiftId = q.shiftId;
    if (q.type) where.employmentType = q.type as any;
    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { employeeCode: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
      ];
    }
    return where;
  }

  @Get()
  @Perm('employees.read')
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(
      z.object({
        search: z.string().optional(),
        siteId: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        designationId: z.string().optional(),
        departmentId: z.string().optional(),
        shiftId: z.string().optional(),
        type: z.enum(TYPES).optional(),
        sort: z.string().default('employeeCode'),
        dir: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(25),
      }),
      query,
    );
    const where = EmployeesController.listWhere(user, q);
    const orderBy = (SORTS[q.sort] ?? SORTS.employeeCode)(q.dir);
    const [total, items, statusCounts] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        include: {
          designation: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          site: { select: { id: true, name: true, code: true } },
          location: { select: { id: true, name: true } },
          defaultShift: { select: { id: true, name: true, code: true, color: true } },
          attendance: { orderBy: { workDate: 'desc' }, take: 1, select: { workDate: true, status: true } },
        },
        orderBy: [orderBy, { employeeCode: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.employee.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: true }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count])),
      items: items.map(({ attendance, photoUrl, ...e }) => ({
        ...e,
        hasPhoto: !!photoUrl,
        lastAttendance: attendance[0] ? { date: dateKey(attendance[0].workDate), status: attendance[0].status } : null,
      })),
    };
  }

  @Get('next-code')
  @Perm('employees.write')
  async nextCode(@CurrentUser() user: AuthUser) {
    const [code] = await this.svc.nextCodes(user.orgId);
    return { code };
  }

  @Get(':id')
  @Perm('employees.read')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id, organizationId: user.orgId },
      include: {
        designation: true,
        department: true,
        site: { select: { id: true, name: true, code: true, timezone: true } },
        location: { select: { id: true, name: true } },
        defaultShift: { select: { id: true, name: true, code: true, startMinute: true, endMinute: true, color: true } },
        siteHistory: { include: { site: { select: { name: true, code: true } } }, orderBy: { startDate: 'desc' } },
        leaveRecords: { orderBy: { startDate: 'desc' }, take: 20 },
        documents: { select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    if (user.siteIds && emp.siteId && !user.siteIds.includes(emp.siteId)) throw new NotFoundException('Employee not found');
    const tz = emp.site?.timezone ?? 'Asia/Kolkata';
    const to = todayIn(tz);
    const from = addDays(to, -89);
    const settings = await this.org.settings(user.orgId);
    const recent = await this.prisma.attendanceRecord.findMany({
      where: { employeeId: id, workDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      include: { shift: { select: { name: true, code: true, color: true } }, site: { select: { name: true } }, markedBy: { select: { fullName: true } } },
      orderBy: { workDate: 'desc' },
    });
    const tally = emptyTally();
    for (const r of recent) addToTally(tally, r);
    return {
      ...emp,
      stats90: { ...tally, attendancePct: attendancePct(tally, settings.countLeaveInPercentage) },
      recentAttendance: recent.map((r) => ({
        id: r.id,
        workDate: dateKey(r.workDate),
        status: r.status,
        shift: r.shift,
        site: r.site.name,
        checkInAt: r.checkInAt,
        checkOutAt: r.checkOutAt,
        workedMinutes: r.workedMinutes,
        overtimeMinutes: r.overtimeMinutes,
        isLate: r.isLate,
        lateMinutes: r.lateMinutes,
        remarks: r.remarks,
        entryMode: r.entryMode,
        markedBy: r.markedBy?.fullName ?? null,
      })),
    };
  }

  private async resolveRefs(user: AuthUser, p: z.infer<typeof empSchema>) {
    if (p.siteId) await this.org.site({ ...user, siteIds: null }, p.siteId);
    if (p.defaultShiftId) {
      const shift = await this.prisma.shift.findFirst({ where: { id: p.defaultShiftId, organizationId: user.orgId } });
      if (!shift) throw new BadRequestException('Shift not found');
      if (p.siteId && shift.siteId !== p.siteId) throw new BadRequestException('The selected shift belongs to a different site');
    }
    if (p.locationId) {
      const loc = await this.prisma.location.findFirst({ where: { id: p.locationId, site: { organizationId: user.orgId } } });
      if (!loc) throw new BadRequestException('Location not found');
      if (p.siteId && loc.siteId !== p.siteId) throw new BadRequestException('The selected location belongs to a different site');
    }
    return {
      designationId: await this.svc.designationId(user.orgId, p.designation),
      departmentId: await this.svc.departmentId(user.orgId, p.department),
    };
  }

  @Post()
  @Perm('employees.write')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(empSchema, body);
    const refs = await this.resolveRefs(user, p);
    const code = p.employeeCode?.trim().toUpperCase() || (await this.svc.nextCodes(user.orgId))[0];
    if (await this.prisma.employee.findUnique({ where: { organizationId_employeeCode: { organizationId: user.orgId, employeeCode: code } } })) {
      throw new ConflictException(`Employee ID ${code} already exists`);
    }
    const today = todayIn('Asia/Kolkata');
    const emp = await this.prisma.employee.create({
      data: {
        organizationId: user.orgId,
        employeeCode: code,
        fullName: p.fullName,
        phone: p.phone || null,
        address: p.address ?? null,
        dateOfBirth: p.dateOfBirth ? dateOnly(p.dateOfBirth) : null,
        emergencyContact: p.emergencyContact ?? null,
        designationId: refs.designationId,
        departmentId: refs.departmentId,
        joiningDate: p.joiningDate ? dateOnly(p.joiningDate) : null,
        employmentType: p.employmentType,
        status: p.status,
        siteId: p.siteId || null,
        locationId: p.locationId || null,
        defaultShiftId: p.defaultShiftId || null,
        weeklyOffDay: p.weeklyOffDay ?? null,
        remarks: p.remarks ?? null,
        photoUrl: p.photoUrl ?? null,
        siteHistory: p.siteId ? { create: { siteId: p.siteId, startDate: dateOnly(p.joiningDate || today), note: 'Initial assignment' } } : undefined,
      },
    });
    await this.audit.log(user, { action: 'employee.create', entity: 'Employee', entityId: emp.id, after: { ...p, photoUrl: p.photoUrl ? '[image]' : null, employeeCode: code } });
    return emp;
  }

  @Patch(':id')
  @Perm('employees.write')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(empSchema.partial(), body);
    const before = await this.prisma.employee.findFirst({ where: { id, organizationId: user.orgId, deletedAt: null } });
    if (!before) throw new NotFoundException('Employee not found');
    if (p.employeeCode && p.employeeCode.toUpperCase() !== before.employeeCode) throw new BadRequestException('Employee ID cannot be changed');
    const merged = { ...p, siteId: p.siteId !== undefined ? p.siteId : before.siteId };
    const refs = await this.resolveRefs(user, merged as any);
    const today = todayIn('Asia/Kolkata');
    const data: Prisma.EmployeeUncheckedUpdateInput = {
      ...(p.fullName !== undefined && { fullName: p.fullName }),
      ...(p.phone !== undefined && { phone: p.phone || null }),
      ...(p.address !== undefined && { address: p.address }),
      ...(p.dateOfBirth !== undefined && { dateOfBirth: p.dateOfBirth ? dateOnly(p.dateOfBirth) : null }),
      ...(p.emergencyContact !== undefined && { emergencyContact: p.emergencyContact }),
      ...(p.designation !== undefined && { designationId: refs.designationId }),
      ...(p.department !== undefined && { departmentId: refs.departmentId }),
      ...(p.joiningDate !== undefined && { joiningDate: p.joiningDate ? dateOnly(p.joiningDate) : null }),
      ...(p.employmentType !== undefined && { employmentType: p.employmentType }),
      ...(p.status !== undefined && { status: p.status }),
      ...(p.siteId !== undefined && { siteId: p.siteId || null }),
      ...(p.locationId !== undefined && { locationId: p.locationId || null }),
      ...(p.defaultShiftId !== undefined && { defaultShiftId: p.defaultShiftId || null }),
      ...(p.weeklyOffDay !== undefined && { weeklyOffDay: p.weeklyOffDay }),
      ...(p.remarks !== undefined && { remarks: p.remarks }),
      ...(p.photoUrl !== undefined && { photoUrl: p.photoUrl }),
    };
    const siteChanged = p.siteId !== undefined && (p.siteId || null) !== before.siteId;
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id }, data });
      if (siteChanged) {
        await tx.employeeSiteAssignment.updateMany({ where: { employeeId: id, endDate: null }, data: { endDate: dateOnly(today) } });
        if (p.siteId) await tx.employeeSiteAssignment.create({ data: { employeeId: id, siteId: p.siteId, startDate: dateOnly(today), note: 'Transferred' } });
        // Future roster entries at the old site no longer apply.
        await tx.rosterEntry.deleteMany({ where: { employeeId: id, workDate: { gt: dateOnly(today) }, siteId: { not: p.siteId ?? '' } } });
      }
      await this.audit.log(
        user,
        { action: 'employee.update', entity: 'Employee', entityId: id, before: { ...before, photoUrl: before.photoUrl ? '[image]' : null }, after: { ...p, photoUrl: p.photoUrl ? '[image]' : p.photoUrl } },
        tx,
      );
      return updated;
    });
    if (siteChanged && p.siteId) {
      await this.notify.toSiteSupervisors(user.orgId, p.siteId, {
        type: 'employee.assignment_changed',
        title: 'Employee assigned to your site',
        body: `${after.fullName} (${after.employeeCode}) has been assigned to your site.`,
        link: `/employees/${after.id}`,
      });
    }
    return after;
  }

  @Post('bulk')
  @HttpCode(200)
  @Perm('employees.write')
  async bulk(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        ids: z.array(z.string()).min(1).max(500),
        action: z.enum(['status', 'site', 'shift', 'weeklyOff']),
        value: z.union([z.string(), z.number()]).nullable(),
      }),
      body,
    );
    const emps = await this.prisma.employee.findMany({ where: { id: { in: p.ids }, organizationId: user.orgId, deletedAt: null } });
    if (emps.length !== p.ids.length) throw new BadRequestException('Some employees were not found');
    let data: Prisma.EmployeeUncheckedUpdateManyInput;
    if (p.action === 'status') data = { status: parse(z.enum(STATUSES), p.value) };
    else if (p.action === 'site') {
      const siteId = parse(z.string(), p.value);
      await this.org.site(user, siteId);
      data = { siteId, defaultShiftId: null, locationId: null };
    } else if (p.action === 'shift') {
      const shiftId = parse(z.string(), p.value);
      const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId: user.orgId } });
      if (!shift) throw new BadRequestException('Shift not found');
      if (emps.some((e) => e.siteId !== shift.siteId)) throw new BadRequestException('All selected employees must belong to the shift’s site');
      data = { defaultShiftId: shiftId };
    } else data = { weeklyOffDay: p.value === null ? null : parse(z.coerce.number().int().min(0).max(6), p.value) };
    const today = todayIn('Asia/Kolkata');
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.updateMany({ where: { id: { in: p.ids } }, data });
      if (p.action === 'site') {
        const moved = emps.filter((e) => e.siteId !== p.value);
        await tx.employeeSiteAssignment.updateMany({ where: { employeeId: { in: moved.map((m) => m.id) }, endDate: null }, data: { endDate: dateOnly(today) } });
        await tx.employeeSiteAssignment.createMany({
          data: moved.map((m) => ({ employeeId: m.id, siteId: p.value as string, startDate: dateOnly(today), note: 'Bulk transfer' })),
        });
      }
      await this.audit.logMany(
        user,
        emps.map((e) => ({ action: `employee.bulk_${p.action}`, entity: 'Employee', entityId: e.id, before: { status: e.status, siteId: e.siteId, defaultShiftId: e.defaultShiftId, weeklyOffDay: e.weeklyOffDay }, after: data })),
        tx,
      );
    });
    return { updated: p.ids.length };
  }

  /** Soft delete: the master record is hidden but attendance history is preserved. */
  @Delete(':id')
  @Perm('employees.write')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: user.orgId, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    await this.prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await this.prisma.rosterEntry.deleteMany({ where: { employeeId: id, workDate: { gt: dateOnly(todayIn('Asia/Kolkata')) } } });
    await this.audit.log(user, { action: 'employee.archive', entity: 'Employee', entityId: id, before: { status: emp.status } });
    return { ok: true };
  }
}
