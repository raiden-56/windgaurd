import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import type { AuthUser } from '../../common/context';
import { PrismaService } from '../../common/prisma.service';
import { addDays, dateKey, dateOnly, eachDay, shiftWindow, weekday } from '../../common/time';

@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates roster entries for a site and date range from each employee's default shift
   * and weekly-off day. Dates that already have entries for the employee are left alone.
   */
  async generateFromDefaults(orgId: string, siteId: string, from: string, to: string, createdById?: string) {
    const days = eachDay(from, to);
    if (days.length > 62) throw new BadRequestException('Generate at most 62 days at a time');
    const [employees, shifts, existing] = await Promise.all([
      this.prisma.employee.findMany({
        where: { organizationId: orgId, siteId, status: 'ACTIVE', deletedAt: null, defaultShiftId: { not: null } },
        select: { id: true, defaultShiftId: true, weeklyOffDay: true, joiningDate: true, locationId: true },
      }),
      this.prisma.shift.findMany({ where: { siteId, isActive: true } }),
      this.prisma.rosterEntry.findMany({
        where: { siteId, workDate: { gte: dateOnly(from), lte: dateOnly(to) } },
        select: { employeeId: true, workDate: true },
      }),
    ]);
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const taken = new Set(existing.map((e) => `${e.employeeId}|${dateKey(e.workDate)}`));
    const data: { organizationId: string; siteId: string; shiftId: string; employeeId: string; workDate: Date; locationId: string | null; createdById?: string }[] = [];
    for (const day of days) {
      const dow = weekday(day);
      for (const e of employees) {
        const shift = shiftMap.get(e.defaultShiftId!);
        if (!shift || !shift.activeDays.includes(dow)) continue;
        if (e.weeklyOffDay === dow) continue;
        if (e.joiningDate && dateKey(e.joiningDate) > day) continue;
        if (taken.has(`${e.id}|${day}`)) continue;
        data.push({ organizationId: orgId, siteId, shiftId: shift.id, employeeId: e.id, workDate: dateOnly(day), locationId: e.locationId, createdById });
      }
    }
    if (data.length) await this.prisma.rosterEntry.createMany({ data, skipDuplicates: true });
    return data.length;
  }

  /** Lazily builds a day's roster the first time anyone opens it. */
  async ensureDay(orgId: string, siteId: string, day: string) {
    const count = await this.prisma.rosterEntry.count({ where: { siteId, workDate: dateOnly(day) } });
    if (count === 0) await this.generateFromDefaults(orgId, siteId, day, day);
  }

  async copyDays(user: AuthUser, siteId: string, sourceFrom: string, targetFrom: string, length: number) {
    const sourceTo = addDays(sourceFrom, length - 1);
    const targetTo = addDays(targetFrom, length - 1);
    const source = await this.prisma.rosterEntry.findMany({
      where: { siteId, workDate: { gte: dateOnly(sourceFrom), lte: dateOnly(sourceTo) } },
    });
    const offset = Math.round((dateOnly(targetFrom).getTime() - dateOnly(sourceFrom).getTime()) / 86400000);
    const active = new Set(
      (await this.prisma.employee.findMany({ where: { organizationId: user.orgId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })).map((e) => e.id),
    );
    const data = source
      .filter((s) => active.has(s.employeeId))
      .map((s) => ({
        organizationId: user.orgId,
        siteId,
        shiftId: s.shiftId,
        employeeId: s.employeeId,
        locationId: s.locationId,
        workDate: dateOnly(addDays(dateKey(s.workDate), offset)),
        createdById: user.id,
      }));
    const res = await this.prisma.rosterEntry.createMany({ data, skipDuplicates: true });
    await this.audit.log(user, {
      action: length === 1 ? 'roster.copy_day' : 'roster.copy_week',
      entity: 'RosterEntry',
      entityId: siteId,
      after: { from: `${sourceFrom}..${sourceTo}`, to: `${targetFrom}..${targetTo}`, created: res.count },
    });
    return { created: res.count, skipped: data.length - res.count };
  }

  /** Overlapping assignments: the same employee scheduled in shifts whose windows intersect. */
  findOverlaps(
    entries: { id: string; employeeId: string; workDate: Date; shift: { id: string; startMinute: number; endMinute: number; breakMinutes: number } }[],
    tz: string,
  ) {
    const byEmp = new Map<string, { id: string; start: number; end: number }[]>();
    for (const e of entries) {
      const w = shiftWindow(dateKey(e.workDate), e.shift, tz);
      const list = byEmp.get(e.employeeId) ?? [];
      list.push({ id: e.id, start: w.start.getTime(), end: w.end.getTime() });
      byEmp.set(e.employeeId, list);
    }
    const overlapping = new Set<string>();
    for (const list of byEmp.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        if (list[i].start < list[i - 1].end) {
          overlapping.add(list[i].id);
          overlapping.add(list[i - 1].id);
        }
      }
    }
    return overlapping;
  }
}
