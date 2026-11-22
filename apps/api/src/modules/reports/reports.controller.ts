import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/context';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { dateKey } from '../../common/time';
import { parse, z, zDate, zId } from '../../common/zod';
import { EmployeesController } from '../employees/employees.controller';
import { ExportService, ReportDoc } from './export.service';
import { ReportParams, ReportsService } from './reports.service';

const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'ON_DUTY', 'NOT_SCHEDULED', 'PENDING', 'INCOMPLETE'] as const;
const reportSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).default('daily'),
  date: zDate.optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  siteId: z.string().optional(),
  projectId: z.string().optional(),
  employeeId: z.string().optional(),
  designationId: z.string().optional(),
  supervisorId: z.string().optional(),
  shiftId: z.string().optional(),
  status: z.enum(STATUSES).optional(),
});
const formatSchema = z.enum(['xlsx', 'csv', 'pdf']);

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async recordExport(user: AuthUser, reportType: string, format: string, filters: unknown, rowCount: number) {
    await this.prisma.exportJob.create({
      data: { organizationId: user.orgId, createdById: user.id, createdByName: user.fullName, reportType, format, filters: filters as object, rowCount },
    });
    await this.audit.log(user, { action: 'report.export', entity: 'Report', entityId: reportType, after: { format, filters, rowCount } });
  }

  @Get('reports/attendance')
  @Perm('reports.read')
  attendance(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.reports.build(user, parse(reportSchema, q) as ReportParams);
  }

  @Get('reports/attendance/export')
  @Perm('reports.export')
  async exportAttendance(@CurrentUser() user: AuthUser, @Query() q: unknown, @Res() res: Response) {
    const p = parse(reportSchema.extend({ format: formatSchema }), q);
    const report = await this.reports.build(user, p as ReportParams);
    const doc = this.reports.toDocument(report);
    await this.recordExport(user, `attendance.${p.period}`, p.format, { ...p, from: report.meta.from, to: report.meta.to }, report.daily.length);
    await this.exporter.send(res, doc, p.format);
  }

  @Get('muster-roll')
  @Perm('reports.read')
  muster(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ siteId: zId, year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }), q);
    return this.reports.muster(user, p.siteId, p.year, p.month);
  }

  @Get('muster-roll/export')
  @Perm('reports.export')
  async exportMuster(@CurrentUser() user: AuthUser, @Query() q: unknown, @Res() res: Response) {
    const p = parse(z.object({ siteId: zId, year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12), format: formatSchema }), q);
    const m = await this.reports.muster(user, p.siteId, p.year, p.month);
    await this.recordExport(user, 'muster-roll', p.format, p, m.rows.length);
    await this.exporter.send(res, this.reports.musterDocument(m, user.fullName), p.format);
  }

  @Post('muster-roll/certify')
  @Perm('attendance.mark')
  async certify(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(z.object({ siteId: zId, year: z.number().int(), month: z.number().int().min(1).max(12), keeperName: z.string().trim().min(2).max(120) }), body);
    const m = await this.reports.muster(user, p.siteId, p.year, p.month);
    const cert = await this.prisma.musterRoll.create({
      data: {
        organizationId: user.orgId,
        siteId: p.siteId,
        year: p.year,
        month: p.month,
        keeperName: p.keeperName,
        keeperUserId: user.id,
        totals: { employees: m.rows.length, ...m.totals },
      },
    });
    await this.audit.log(user, { action: 'muster.certify', entity: 'MusterRoll', entityId: cert.id, after: { ...p, employees: m.rows.length, ...m.totals } });
    return cert;
  }

  @Get('exports')
  @Perm('reports.read')
  exportsHistory(@CurrentUser() user: AuthUser) {
    return this.prisma.exportJob.findMany({ where: { organizationId: user.orgId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Get('employees-export')
  @Perm('employees.read', 'reports.export')
  async exportEmployees(@CurrentUser() user: AuthUser, @Query() q: unknown, @Res() res: Response) {
    const p = parse(
      z.object({ format: formatSchema, search: z.string().optional(), siteId: z.string().optional(), status: z.string().optional(), designationId: z.string().optional(), shiftId: z.string().optional() }),
      q,
    );
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } });
    const items = await this.prisma.employee.findMany({
      where: EmployeesController.listWhere(user, p),
      include: { designation: true, department: true, site: true, defaultShift: true, location: true },
      orderBy: { employeeCode: 'asc' },
    });
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const doc: ReportDoc = {
      title: 'Employee Directory',
      fileName: `windguard-employees-${DateTime.now().toISODate()}`,
      meta: [
        { label: 'Company', value: org.name },
        { label: 'Generated on', value: DateTime.now().setZone('Asia/Kolkata').toFormat('dd LLL yyyy, HH:mm') },
        { label: 'Generated by', value: user.fullName },
        { label: 'Records', value: String(items.length) },
      ],
      landscape: true,
      sections: [
        {
          name: 'Employees',
          columns: [
            { key: 'employeeCode', label: 'Employee ID', width: 10 },
            { key: 'fullName', label: 'Employee Name', width: 20 },
            { key: 'phone', label: 'Phone Number', width: 13 },
            { key: 'designation', label: 'Designation', width: 14 },
            { key: 'department', label: 'Department', width: 12 },
            { key: 'joiningDate', label: 'Joining Date', width: 11 },
            { key: 'employmentType', label: 'Employment Type', width: 11 },
            { key: 'site', label: 'Assigned Site', width: 16 },
            { key: 'location', label: 'Deployment', width: 13 },
            { key: 'shift', label: 'Assigned Shift', width: 9 },
            { key: 'weeklyOff', label: 'Weekly Off', width: 8 },
            { key: 'status', label: 'Status', width: 9 },
          ],
          rows: items.map((e) => ({
            employeeCode: e.employeeCode,
            fullName: e.fullName,
            phone: e.phone ?? '',
            designation: e.designation?.name ?? '',
            department: e.department?.name ?? '',
            joiningDate: e.joiningDate ? dateKey(e.joiningDate) : '',
            employmentType: e.employmentType,
            site: e.site?.code ?? '',
            location: e.location?.name ?? '',
            shift: e.defaultShift?.code ?? '',
            weeklyOff: e.weeklyOffDay != null ? DAYS[e.weeklyOffDay] : '',
            status: e.status,
          })),
        },
      ],
    };
    await this.recordExport(user, 'employees', p.format, p, items.length);
    await this.exporter.send(res, doc, p.format);
  }
}
