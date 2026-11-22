import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, OnModuleInit, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../../common/queue.service';
import { dateOnly, todayIn } from '../../common/time';
import { parse, z } from '../../common/zod';
import type { Prisma } from '../../generated/prisma/client';
import { PHONE_RE } from '../employees/employees.controller';
import { EmployeesService } from '../employees/employees.service';

export const IMPORT_FIELDS = [
  { key: 'employeeCode', label: 'Employee ID', aliases: ['employee id', 'emp id', 'emp code', 'employee code', 'id', 'empid', 'staff id'] },
  { key: 'fullName', label: 'Employee Name', aliases: ['employee name', 'name', 'full name', 'worker name', 'guard name'], required: true },
  { key: 'phone', label: 'Phone Number', aliases: ['phone number', 'phone', 'mobile', 'mobile number', 'contact', 'contact number'] },
  { key: 'designation', label: 'Designation', aliases: ['designation', 'role', 'position', 'post'] },
  { key: 'department', label: 'Department', aliases: ['department', 'dept'] },
  { key: 'joiningDate', label: 'Joining Date', aliases: ['joining date', 'date of joining', 'doj', 'join date'] },
  { key: 'employmentType', label: 'Employment Type', aliases: ['employment type', 'type', 'emp type'] },
  { key: 'site', label: 'Assigned Site', aliases: ['assigned site', 'site', 'site code', 'location', 'deployment location'] },
  { key: 'shift', label: 'Assigned Shift', aliases: ['assigned shift', 'shift', 'shift code'] },
  { key: 'status', label: 'Status', aliases: ['status', 'employment status'] },
] as const;
type FieldKey = (typeof IMPORT_FIELDS)[number]['key'];

const TYPES = ['PERMANENT', 'CONTRACT', 'TEMPORARY', 'TRAINEE'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'];
const MAX_ROWS = 5000;

type Cell = string | null;
interface CheckedRow {
  rowNumber: number;
  data: Record<FieldKey, Cell>;
  normalized: {
    employeeCode: string | null;
    fullName: string;
    phone: string | null;
    designation: string | null;
    department: string | null;
    joiningDate: string | null;
    employmentType: string;
    status: string;
    siteId: string | null;
    shiftId: string | null;
  };
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
  existingId: string | null;
}

function cellText(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return DateTime.fromJSDate(v, { zone: 'utc' }).toISODate();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim() || null;
    if ('text' in v) return String((v as any).text).trim() || null;
    if ('result' in v) return cellText((v as any).result);
    return null;
  }
  const s = String(v).trim();
  return s || null;
}

function normDate(s: Cell): string | null | 'INVALID' {
  if (!s) return null;
  const formats = ['yyyy-MM-dd', 'dd-MM-yyyy', 'dd/MM/yyyy', 'd/M/yyyy', 'd-M-yyyy', 'dd.MM.yyyy', 'dd-MMM-yyyy', 'd MMM yyyy'];
  for (const f of formats) {
    const d = DateTime.fromFormat(s, f, { zone: 'utc' });
    if (d.isValid && d.year > 1950 && d.year < 2100) return d.toISODate();
  }
  // Excel serial number
  if (/^\d{5}$/.test(s)) {
    const d = DateTime.fromISO('1899-12-30', { zone: 'utc' }).plus({ days: Number(s) });
    if (d.isValid) return d.toISODate();
  }
  return 'INVALID';
}

@Controller('imports')
export class ImportsController implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly employees: EmployeesService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.queue.register('employee-import', (data: { jobId: string; user: AuthUser }) => this.process(data.jobId, data.user));
  }

  @Get('fields')
  @Perm('employees.import')
  fields() {
    return IMPORT_FIELDS;
  }

  @Get()
  @Perm('employees.import')
  history(@CurrentUser() user: AuthUser) {
    return this.prisma.importJob.findMany({
      where: { organizationId: user.orgId },
      select: { id: true, fileName: true, status: true, totalRows: true, validRows: true, createdCount: true, updatedCount: true, skippedCount: true, failedCount: true, mode: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  @Get('template')
  @Perm('employees.import')
  async template(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const [sites, shifts, designations] = await Promise.all([
      this.prisma.site.findMany({ where: { organizationId: user.orgId, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.shift.findMany({ where: { organizationId: user.orgId, isActive: true }, include: { site: true }, orderBy: [{ siteId: 'asc' }, { sortOrder: 'asc' }] }),
      this.prisma.designation.findMany({ where: { organizationId: user.orgId }, orderBy: { name: 'asc' } }),
    ]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WINDGUARD';
    const ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = IMPORT_FIELDS.map((f) => ({ header: f.label, key: f.key, width: Math.max(16, f.label.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111C2D' } };
    const s0 = sites[0];
    const sh0 = shifts.find((s) => s.siteId === s0?.id);
    ws.addRow({ employeeCode: '', fullName: 'Example: Ramesh Kumar Patel', phone: '9876543210', designation: designations[0]?.name ?? 'Security Guard', department: 'Security', joiningDate: '2025-04-01', employmentType: 'CONTRACT', site: s0?.code ?? '', shift: sh0?.code ?? 'S1', status: 'ACTIVE' });
    ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
    const help = wb.addWorksheet('Instructions');
    help.columns = [{ width: 22 }, { width: 90 }];
    const rows: [string, string][] = [
      ['Column', 'Rules'],
      ['Employee ID', 'Optional. Leave blank to auto-generate. Existing IDs update that employee if you choose "Update existing".'],
      ['Employee Name', 'Required.'],
      ['Phone Number', '10-digit mobile number, optionally with country code (e.g. +91 9876543210).'],
      ['Designation', 'Existing designation name. New names are created with a warning.'],
      ['Joining Date', 'YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY.'],
      ['Employment Type', TYPES.join(', ')],
      ['Assigned Site', 'Site code or exact site name (see the Reference sheet).'],
      ['Assigned Shift', 'Shift code at that site, e.g. S1, S2, S3.'],
      ['Status', STATUSES.join(', ') + ' (default ACTIVE)'],
      ['Note', 'Delete the example row before uploading.'],
    ];
    rows.forEach((r) => help.addRow(r));
    help.getRow(1).font = { bold: true };
    const ref = wb.addWorksheet('Reference');
    ref.columns = [{ header: 'Site Code', width: 14 }, { header: 'Site Name', width: 36 }, { header: 'Shift Code', width: 12 }, { header: 'Shift', width: 20 }];
    ref.getRow(1).font = { bold: true };
    for (const s of shifts) ref.addRow([s.site.code, s.site.name, s.code, s.name]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="windguard-employee-import-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  @Post('upload')
  @HttpCode(200)
  @Perm('employees.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an Excel (.xlsx) or CSV file');
    const name = file.originalname.toLowerCase();
    let matrix: Cell[][];
    try {
      if (name.endsWith('.csv')) {
        matrix = (parseCsv(file.buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][]).map((r) => r.map((c) => (c === '' ? null : c)));
      } else if (name.endsWith('.xlsx')) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(file.buffer as any);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('Workbook has no sheets');
        matrix = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const vals: Cell[] = [];
          for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(row.getCell(c).value));
          matrix.push(vals);
        });
      } else {
        throw new BadRequestException('Only .xlsx and .csv files are supported');
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not read the file: ${err.message}`);
    }
    const [headerRow, ...dataRows] = matrix;
    if (!headerRow?.some(Boolean)) throw new BadRequestException('The first row must contain column headings');
    const headers = headerRow.map((h, i) => h ?? `Column ${i + 1}`);
    const rows = dataRows.filter((r) => r.some((c) => c !== null)).map((r) => headers.map((_, i) => r[i] ?? null));
    if (!rows.length) throw new BadRequestException('The file has no data rows');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per import`);

    const mapping: Record<string, string | null> = {};
    for (const f of IMPORT_FIELDS) {
      const idx = headers.findIndex((h) => (f.aliases as readonly string[]).includes(h.toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ').trim()));
      mapping[f.key] = idx >= 0 ? headers[idx] : null;
    }
    const job = await this.prisma.importJob.create({
      data: {
        organizationId: user.orgId,
        createdById: user.id,
        fileName: file.originalname,
        headers,
        rows: rows as unknown as Prisma.InputJsonValue,
        mapping,
        totalRows: rows.length,
      },
    });
    await this.audit.log(user, { action: 'import.upload', entity: 'ImportJob', entityId: job.id, after: { fileName: file.originalname, rows: rows.length } });
    return { jobId: job.id, fileName: file.originalname, headers, mapping, totalRows: rows.length, preview: rows.slice(0, 5) };
  }

  private async check(user: AuthUser, jobId: string, mapping: Record<string, string | null>): Promise<CheckedRow[]> {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, organizationId: user.orgId } });
    if (!job) throw new NotFoundException('Import not found');
    const headers = job.headers as string[];
    const rows = job.rows as unknown as Cell[][];
    const idx = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, mapping[f.key] ? headers.indexOf(mapping[f.key]!) : -1])) as Record<FieldKey, number>;
    if (idx.fullName < 0) throw new BadRequestException('Map the "Employee Name" column');

    const [sites, shifts, designations, existing] = await Promise.all([
      this.prisma.site.findMany({ where: { organizationId: user.orgId } }),
      this.prisma.shift.findMany({ where: { organizationId: user.orgId } }),
      this.prisma.designation.findMany({ where: { organizationId: user.orgId } }),
      this.prisma.employee.findMany({ where: { organizationId: user.orgId, deletedAt: null }, select: { id: true, employeeCode: true, fullName: true, phone: true } }),
    ]);
    const siteBy = new Map<string, (typeof sites)[number]>();
    for (const s of sites) {
      siteBy.set(s.code.toLowerCase(), s);
      siteBy.set(s.name.toLowerCase(), s);
    }
    const desigSet = new Set(designations.map((d) => d.name.toLowerCase()));
    const byCode = new Map(existing.map((e) => [e.employeeCode.toUpperCase(), e]));
    const byNamePhone = new Map(existing.filter((e) => e.phone).map((e) => [`${e.fullName.toLowerCase()}|${e.phone!.replace(/\D/g, '').slice(-10)}`, e]));
    const seenCodes = new Map<string, number>();
    const seenNamePhone = new Map<string, number>();

    return rows.map((r, i) => {
      const rowNumber = i + 2; // header is row 1
      const get = (k: FieldKey) => (idx[k] >= 0 ? (r[idx[k]] ?? null) : null);
      const data = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, get(f.key)])) as Record<FieldKey, Cell>;
      const errors: CheckedRow['errors'] = [];
      const warnings: CheckedRow['warnings'] = [];

      const fullName = (data.fullName ?? '').replace(/\s+/g, ' ').trim();
      if (!fullName) errors.push({ field: 'fullName', message: 'Employee name is missing' });
      else if (fullName.length < 2 || fullName.length > 120 || /\d/.test(fullName)) errors.push({ field: 'fullName', message: 'Employee name looks invalid' });

      let code = data.employeeCode ? data.employeeCode.trim().toUpperCase() : null;
      let existingId: string | null = null;
      if (code) {
        if (!/^[A-Z0-9\-_/]{2,20}$/.test(code)) {
          errors.push({ field: 'employeeCode', message: 'Invalid employee ID (2–20 letters, digits, - _ /)' });
          code = null;
        } else {
          if (seenCodes.has(code)) errors.push({ field: 'employeeCode', message: `Duplicate employee ID in file (also row ${seenCodes.get(code)})` });
          else seenCodes.set(code, rowNumber);
          const ex = byCode.get(code);
          if (ex) {
            existingId = ex.id;
            warnings.push({ field: 'employeeCode', message: `Matches existing employee ${ex.fullName}` });
          }
        }
      }

      let phone: string | null = null;
      if (data.phone) {
        const compact = data.phone.replace(/[\s()-]/g, '');
        if (!PHONE_RE.test(compact)) errors.push({ field: 'phone', message: 'Invalid phone number' });
        else phone = compact;
      }
      if (fullName && phone) {
        const key = `${fullName.toLowerCase()}|${phone.replace(/\D/g, '').slice(-10)}`;
        const dup = byNamePhone.get(key);
        if (dup && dup.id !== existingId) warnings.push({ field: 'fullName', message: `Possible duplicate of ${dup.employeeCode} (same name and phone)` });
        if (seenNamePhone.has(key)) errors.push({ field: 'fullName', message: `Duplicate record in file (same as row ${seenNamePhone.get(key)})` });
        else seenNamePhone.set(key, rowNumber);
      }

      const jd = normDate(data.joiningDate);
      if (jd === 'INVALID') errors.push({ field: 'joiningDate', message: 'Invalid date (use YYYY-MM-DD or DD-MM-YYYY)' });
      else if (jd && jd > todayIn('Asia/Kolkata')) warnings.push({ field: 'joiningDate', message: 'Joining date is in the future' });

      let site: (typeof sites)[number] | undefined;
      if (data.site) {
        site = siteBy.get(data.site.trim().toLowerCase());
        if (!site) errors.push({ field: 'site', message: `Unknown site "${data.site}"` });
      } else warnings.push({ field: 'site', message: 'No site assigned' });

      let shiftId: string | null = null;
      if (data.shift) {
        if (!site) {
          if (data.site) {
            /* site error already reported */
          } else errors.push({ field: 'shift', message: 'A shift requires an assigned site' });
        } else {
          const s = shifts.find((x) => x.siteId === site!.id && (x.code.toLowerCase() === data.shift!.trim().toLowerCase() || x.name.toLowerCase() === data.shift!.trim().toLowerCase()));
          if (!s) errors.push({ field: 'shift', message: `Shift "${data.shift}" does not exist at ${site.name}` });
          else shiftId = s.id;
        }
      }

      const designation = data.designation?.trim() || null;
      if (designation) {
        if (designation.length > 80 || !/[A-Za-z]/.test(designation)) errors.push({ field: 'designation', message: 'Invalid designation' });
        else if (!desigSet.has(designation.toLowerCase())) warnings.push({ field: 'designation', message: `New designation "${designation}" will be created` });
      }

      const type = (data.employmentType ?? 'CONTRACT').trim().toUpperCase();
      if (!TYPES.includes(type)) errors.push({ field: 'employmentType', message: `Employment type must be one of ${TYPES.join(', ')}` });
      const status = (data.status ?? 'ACTIVE').trim().toUpperCase();
      if (!STATUSES.includes(status)) errors.push({ field: 'status', message: `Status must be one of ${STATUSES.join(', ')}` });

      return {
        rowNumber,
        data,
        normalized: {
          employeeCode: code,
          fullName,
          phone,
          designation,
          department: data.department?.trim() || null,
          joiningDate: jd === 'INVALID' ? null : jd,
          employmentType: type,
          status,
          siteId: site?.id ?? null,
          shiftId,
        },
        errors,
        warnings,
        existingId,
      };
    });
  }

  @Post(':id/validate')
  @HttpCode(200)
  @Perm('employees.import')
  async validate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { mapping } = parse(z.object({ mapping: z.record(z.string(), z.string().nullable()) }), body);
    const checked = await this.check(user, id, mapping);
    const valid = checked.filter((r) => !r.errors.length);
    await this.prisma.$transaction([
      this.prisma.importError.deleteMany({ where: { jobId: id } }),
      this.prisma.importError.createMany({
        data: checked.flatMap((r) => [
          ...r.errors.map((e) => ({ jobId: id, rowNumber: r.rowNumber, field: e.field, severity: 'ERROR', message: e.message })),
          ...r.warnings.map((e) => ({ jobId: id, rowNumber: r.rowNumber, field: e.field, severity: 'WARNING', message: e.message })),
        ]),
      }),
      this.prisma.importJob.update({ where: { id }, data: { mapping, status: 'VALIDATED', validRows: valid.length } }),
    ]);
    return {
      totalRows: checked.length,
      validRows: valid.length,
      errorRows: checked.length - valid.length,
      warningRows: checked.filter((r) => r.warnings.length).length,
      existingRows: checked.filter((r) => r.existingId).length,
      rows: checked.map((r) => ({ rowNumber: r.rowNumber, data: r.data, errors: r.errors, warnings: r.warnings, existing: !!r.existingId })),
    };
  }

  @Post(':id/commit')
  @HttpCode(200)
  @Perm('employees.import')
  async commit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(z.object({ rows: z.array(z.number().int()).min(1), existing: z.enum(['update', 'skip']) }), body);
    const job = await this.prisma.importJob.findFirst({ where: { id, organizationId: user.orgId } });
    if (!job) throw new NotFoundException('Import not found');
    if (job.status !== 'VALIDATED') throw new ConflictException(job.status === 'COMPLETED' ? 'This import has already been processed' : 'Validate the file before importing');
    await this.prisma.importJob.update({ where: { id }, data: { status: 'PROCESSING', mode: p.existing, result: { selected: p.rows } } });
    await this.queue.enqueue('employee-import', { jobId: id, user: { ...user, permissions: [...user.permissions] } });
    return { jobId: id, status: 'PROCESSING', queue: this.queue.mode };
  }

  /** Background worker: imports each selected row independently and records the outcome. */
  private async process(jobId: string, rawUser: any) {
    const user: AuthUser = { ...rawUser, permissions: new Set(rawUser.permissions) };
    const job = await this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    const selected = new Set<number>((job.result as any)?.selected ?? []);
    try {
      const checked = await this.check(user, jobId, job.mapping as Record<string, string | null>);
      const outcomes: { rowNumber: number; outcome: 'created' | 'updated' | 'skipped' | 'failed'; employeeCode?: string; message?: string }[] = [];
      const today = todayIn('Asia/Kolkata');
      for (const r of checked) {
        if (!selected.has(r.rowNumber)) continue;
        if (r.errors.length) {
          outcomes.push({ rowNumber: r.rowNumber, outcome: 'failed', message: r.errors.map((e) => e.message).join('; ') });
          continue;
        }
        if (r.existingId && job.mode === 'skip') {
          outcomes.push({ rowNumber: r.rowNumber, outcome: 'skipped', employeeCode: r.normalized.employeeCode!, message: 'Existing employee skipped' });
          continue;
        }
        try {
          const n = r.normalized;
          const res = await this.prisma.$transaction(async (tx) => {
            const designationId = await this.employees.designationId(user.orgId, n.designation, tx);
            const departmentId = await this.employees.departmentId(user.orgId, n.department, tx);
            const fields = {
              fullName: n.fullName,
              phone: n.phone,
              designationId,
              departmentId,
              joiningDate: n.joiningDate ? dateOnly(n.joiningDate) : null,
              employmentType: n.employmentType as any,
              status: n.status as any,
              siteId: n.siteId,
              defaultShiftId: n.shiftId,
            };
            if (r.existingId) {
              const before = await tx.employee.findUniqueOrThrow({ where: { id: r.existingId } });
              const after = await tx.employee.update({ where: { id: r.existingId }, data: fields });
              if (before.siteId !== n.siteId) {
                await tx.employeeSiteAssignment.updateMany({ where: { employeeId: before.id, endDate: null }, data: { endDate: dateOnly(today) } });
                if (n.siteId) await tx.employeeSiteAssignment.create({ data: { employeeId: before.id, siteId: n.siteId, startDate: dateOnly(today), note: 'Import update' } });
              }
              await this.audit.log(user, { action: 'employee.import_update', entity: 'Employee', entityId: before.id, before, after: fields, reason: `Import ${job.fileName} row ${r.rowNumber}` }, tx);
              return { outcome: 'updated' as const, code: after.employeeCode };
            }
            const code = n.employeeCode ?? (await this.employees.nextCodes(user.orgId, 1, tx))[0];
            const emp = await tx.employee.create({
              data: {
                ...fields,
                organizationId: user.orgId,
                employeeCode: code,
                siteHistory: n.siteId ? { create: { siteId: n.siteId, startDate: dateOnly(n.joiningDate ?? today), note: 'Imported' } } : undefined,
              },
            });
            await this.audit.log(user, { action: 'employee.import_create', entity: 'Employee', entityId: emp.id, after: { ...fields, employeeCode: code }, reason: `Import ${job.fileName} row ${r.rowNumber}` }, tx);
            return { outcome: 'created' as const, code };
          });
          outcomes.push({ rowNumber: r.rowNumber, outcome: res.outcome, employeeCode: res.code });
        } catch (err: any) {
          outcomes.push({ rowNumber: r.rowNumber, outcome: 'failed', message: err?.code === 'P2002' ? 'Employee ID already exists' : (err?.message ?? 'Failed') });
        }
      }
      const count = (o: string) => outcomes.filter((x) => x.outcome === o).length;
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          createdCount: count('created'),
          updatedCount: count('updated'),
          skippedCount: count('skipped'),
          failedCount: count('failed'),
          result: { selected: [...selected], outcomes },
        },
      });
      await this.audit.log(user, {
        action: 'import.complete',
        entity: 'ImportJob',
        entityId: jobId,
        after: { created: count('created'), updated: count('updated'), skipped: count('skipped'), failed: count('failed') },
      });
      await this.notify.toUsers(user.orgId, [user.id], {
        type: 'import.completed',
        title: 'Employee import finished',
        body: `${job.fileName}: ${count('created')} created, ${count('updated')} updated, ${count('skipped')} skipped, ${count('failed')} failed.`,
        link: '/import-export',
        severity: count('failed') ? 'WARNING' : 'SUCCESS',
      });
    } catch (err: any) {
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'FAILED', result: { selected: [...selected], error: err?.message } } });
    }
  }

  @Get(':id')
  @Perm('employees.import')
  async status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: user.orgId },
      select: { id: true, fileName: true, status: true, totalRows: true, validRows: true, createdCount: true, updatedCount: true, skippedCount: true, failedCount: true, result: true, mode: true, createdAt: true, headers: true, mapping: true },
    });
    if (!job) throw new NotFoundException('Import not found');
    return job;
  }

  @Get(':id/error-report')
  @Perm('employees.import')
  async errorReport(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const job = await this.prisma.importJob.findFirst({ where: { id, organizationId: user.orgId }, include: { errors: { orderBy: [{ rowNumber: 'asc' }, { severity: 'asc' }] } } });
    if (!job) throw new NotFoundException('Import not found');
    const headers = job.headers as string[];
    const rows = job.rows as unknown as Cell[][];
    const outcomes = new Map<number, { outcome: string; message?: string }>(((job.result as any)?.outcomes ?? []).map((o: any) => [o.rowNumber, o]));
    const byRow = new Map<number, typeof job.errors>();
    for (const e of job.errors) byRow.set(e.rowNumber, [...(byRow.get(e.rowNumber) ?? []), e]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Row', width: 8 },
      { header: 'Severity', width: 11 },
      { header: 'Field', width: 16 },
      { header: 'Message', width: 60 },
      { header: 'Import outcome', width: 16 },
      ...headers.map((h) => ({ header: h, width: 18 })),
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111C2D' } };
    const rowNums = new Set([...byRow.keys(), ...[...outcomes.entries()].filter(([, o]) => o.outcome === 'failed').map(([n]) => n)]);
    for (const n of [...rowNums].sort((a, b) => a - b)) {
      const issues = byRow.get(n) ?? [];
      const o = outcomes.get(n);
      const src = rows[n - 2] ?? [];
      if (!issues.length && o) ws.addRow([n, 'ERROR', '', o.message ?? 'Failed', o.outcome, ...src]);
      for (const e of issues) {
        const r = ws.addRow([n, e.severity, e.field ?? '', e.message, o?.outcome ?? 'not imported', ...src]);
        r.getCell(2).font = { color: { argb: e.severity === 'ERROR' ? 'FFDC2626' : 'FFD97706' }, bold: true };
      }
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-issues-${job.fileName.replace(/[^\w.-]/g, '_')}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }
}
