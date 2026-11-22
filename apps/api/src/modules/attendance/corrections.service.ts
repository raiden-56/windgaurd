import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import type { AuthUser } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { PrismaService } from '../../common/prisma.service';
import { dateKey } from '../../common/time';
import type { AttendanceStatus, Prisma } from '../../generated/prisma/client';
import { derive } from './attendance.engine';
import { snapshot } from './attendance.service';

export interface ProposedChange {
  status?: AttendanceStatus;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  remarks?: string | null;
}

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly org: OrgService,
  ) {}

  async request(user: AuthUser, attendanceId: string, reason: string, proposed: ProposedChange) {
    const rec = await this.prisma.attendanceRecord.findFirst({
      where: { id: attendanceId, organizationId: user.orgId },
      include: { employee: { select: { fullName: true, employeeCode: true } }, site: true, shift: true },
    });
    if (!rec) throw new NotFoundException('Attendance record not found');
    if (user.siteIds && !user.siteIds.includes(rec.siteId)) throw new ForbiddenException('Not your site');
    const changes = Object.fromEntries(Object.entries(proposed).filter(([, v]) => v !== undefined));
    if (!Object.keys(changes).length) throw new BadRequestException('Propose at least one change');
    const pending = await this.prisma.attendanceCorrection.count({ where: { attendanceId, status: 'PENDING' } });
    if (pending) throw new ConflictException('A correction for this record is already awaiting review');
    this.validate(rec, changes);

    const corr = await this.prisma.attendanceCorrection.create({
      data: {
        organizationId: user.orgId,
        attendanceId,
        requestedById: user.id,
        reason,
        previousValues: snapshot(rec) as Prisma.InputJsonValue,
        proposedValues: changes as Prisma.InputJsonValue,
      },
    });
    await this.audit.log(user, {
      action: 'attendance.correction.request',
      entity: 'AttendanceCorrection',
      entityId: corr.id,
      before: snapshot(rec),
      after: changes,
      reason,
    });
    await this.notify.toAdmins(user.orgId, {
      type: 'correction.requested',
      title: 'Attendance correction requested',
      body: `${user.fullName} requested a change for ${rec.employee.fullName} (${rec.employee.employeeCode}) · ${rec.shift.name} · ${dateKey(rec.workDate)}: ${reason}`,
      link: '/attendance/corrections',
      severity: 'WARNING',
      dedupeKey: `correction:${corr.id}`,
    });
    return corr;
  }

  private validate(rec: { checkInAt: Date | null; checkOutAt: Date | null; scheduledStart: Date; scheduledEnd: Date }, c: ProposedChange) {
    const inAt = c.checkInAt !== undefined ? (c.checkInAt ? new Date(c.checkInAt) : null) : rec.checkInAt;
    const outAt = c.checkOutAt !== undefined ? (c.checkOutAt ? new Date(c.checkOutAt) : null) : rec.checkOutAt;
    if (inAt && Number.isNaN(inAt.getTime())) throw new BadRequestException('Invalid check-in time');
    if (outAt && Number.isNaN(outAt.getTime())) throw new BadRequestException('Invalid check-out time');
    if (outAt && !inAt) throw new BadRequestException('Check-out requires a check-in time');
    if (inAt && outAt && outAt <= inAt) throw new BadRequestException('Check-out must be after check-in');
    if (inAt && outAt && outAt.getTime() - inAt.getTime() > 20 * 3600_000) throw new BadRequestException('Shift span cannot exceed 20 hours');
    if (inAt && Math.abs(inAt.getTime() - rec.scheduledStart.getTime()) > 12 * 3600_000) {
      throw new BadRequestException('Check-in must be within 12 hours of the scheduled start');
    }
  }

  async list(user: AuthUser, status?: string) {
    return this.prisma.attendanceCorrection.findMany({
      where: {
        organizationId: user.orgId,
        ...(status ? { status: status as any } : {}),
        ...(user.siteIds ? { attendance: { siteId: { in: user.siteIds } } } : {}),
      },
      include: {
        requestedBy: { select: { fullName: true, role: true } },
        reviewedBy: { select: { fullName: true } },
        attendance: {
          select: {
            id: true,
            siteId: true,
            shiftId: true,
            workDate: true,
            status: true,
            employee: { select: { employeeCode: true, fullName: true } },
            site: { select: { name: true, timezone: true } },
            shift: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async review(user: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
    const corr = await this.prisma.attendanceCorrection.findFirst({
      where: { id, organizationId: user.orgId },
      include: { attendance: { include: { shift: true, employee: { select: { fullName: true } } } } },
    });
    if (!corr) throw new NotFoundException('Correction not found');
    if (corr.status !== 'PENDING') throw new ConflictException('This correction has already been reviewed');
    if (decision === 'REJECTED' && !note?.trim()) throw new BadRequestException('Give a reason for rejecting');
    const settings = await this.org.settings(user.orgId);

    await this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: corr.attendanceId } });
      if (decision === 'APPROVED') {
        const p = corr.proposedValues as ProposedChange;
        const next = {
          status: (p.status ?? rec.status) as AttendanceStatus,
          checkInAt: p.checkInAt !== undefined ? (p.checkInAt ? new Date(p.checkInAt) : null) : rec.checkInAt,
          checkOutAt: p.checkOutAt !== undefined ? (p.checkOutAt ? new Date(p.checkOutAt) : null) : rec.checkOutAt,
          scheduledStart: rec.scheduledStart,
          scheduledEnd: rec.scheduledEnd,
        };
        const d = derive(next, corr.attendance.shift, settings, { autoStatusOnCheckout: p.status === undefined });
        const saved = await tx.attendanceRecord.update({
          where: { id: rec.id },
          data: {
            status: d.status,
            checkInAt: next.checkInAt,
            checkOutAt: next.checkOutAt,
            workedMinutes: d.workedMinutes,
            overtimeMinutes: d.overtimeMinutes,
            lateMinutes: d.lateMinutes,
            isLate: d.isLate,
            remarks: p.remarks !== undefined ? p.remarks : rec.remarks,
            entryMode: 'CORRECTION',
            version: { increment: 1 },
          },
        });
        await this.audit.log(
          user,
          { action: 'attendance.correction.apply', entity: 'AttendanceRecord', entityId: rec.id, before: snapshot(rec), after: snapshot(saved), reason: corr.reason },
          tx,
        );
      }
      await tx.attendanceCorrection.update({
        where: { id },
        data: { status: decision, reviewedById: user.id, reviewNote: note ?? null, reviewedAt: new Date() },
      });
      await this.audit.log(
        user,
        { action: `attendance.correction.${decision === 'APPROVED' ? 'approve' : 'reject'}`, entity: 'AttendanceCorrection', entityId: id, after: { decision, note }, reason: note },
        tx,
      );
    });

    await this.notify.toUsers(user.orgId, [corr.requestedById], {
      type: 'correction.reviewed',
      title: `Correction ${decision.toLowerCase()}`,
      body: `Your correction for ${corr.attendance.employee.fullName} (${dateKey(corr.attendance.workDate)}) was ${decision.toLowerCase()} by ${user.fullName}.${note ? ` ${note}` : ''}`,
      link: '/attendance/corrections',
      severity: decision === 'APPROVED' ? 'SUCCESS' : 'WARNING',
    });
    return { ok: true };
  }
}
