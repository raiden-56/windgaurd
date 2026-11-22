import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/context';
import { NotifyService } from '../../common/notify.service';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { dateOnly } from '../../common/time';
import type { AttendanceStatus, Prisma } from '../../generated/prisma/client';
import { AttendanceService } from './attendance.service';

export interface OfflineAction {
  clientId: string;
  action: 'MARK' | 'CHECK_IN' | 'CHECK_OUT';
  siteId: string;
  shiftId: string;
  workDate: string;
  employeeId: string;
  status?: AttendanceStatus;
  time?: string | null;
  remarks?: string | null;
  deviceRecordedAt: string;
  /** Server version of the record when the device last saw it; null = no record existed. */
  baseVersion: number | null;
  /** Earlier queued action for the same employee/shift/date (chained offline edits). */
  prevClientId?: string | null;
}

export interface SyncResult {
  clientId: string;
  result: 'SYNCED' | 'CONFLICT' | 'FAILED';
  message?: string;
  attendanceId?: string;
  version?: number;
  server?: unknown;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Applies queued offline actions in order. Idempotent per clientId. A record that
   * changed on the server since the device's snapshot is reported as a CONFLICT and is
   * never overwritten silently.
   */
  async sync(user: AuthUser, actions: OfflineAction[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const a of actions) results.push(await this.applyOne(user, a));
    const synced = results.filter((r) => r.result === 'SYNCED').length;
    const conflicts = results.filter((r) => r.result === 'CONFLICT').length;
    if (synced || conflicts) {
      await this.notify.toUsers(user.orgId, [user.id], {
        type: 'sync.completed',
        title: 'Offline attendance synchronized',
        body: `${synced} record(s) synchronized${conflicts ? `, ${conflicts} need review` : ''}.`,
        link: '/attendance/sync',
        severity: conflicts ? 'WARNING' : 'SUCCESS',
      });
    }
    return results;
  }

  private async applyOne(user: AuthUser, a: OfflineAction): Promise<SyncResult> {
    const prior = await this.prisma.offlineSyncRecord.findUnique({ where: { clientId: a.clientId } });
    if (prior?.result === 'FAILED') {
      // Failures (validation/transient) may be retried; synced and conflict outcomes are final.
      await this.prisma.offlineSyncRecord.delete({ where: { id: prior.id } });
    } else if (prior) {
      const p = prior.payload as any;
      return { clientId: a.clientId, result: prior.result as SyncResult['result'], message: prior.message ?? undefined, attendanceId: prior.attendanceId ?? undefined, version: p?.resultVersion };
    }

    const store = async (r: SyncResult) => {
      await this.prisma.offlineSyncRecord.create({
        data: {
          organizationId: user.orgId,
          clientId: a.clientId,
          userId: user.id,
          siteId: a.siteId,
          employeeId: a.employeeId,
          shiftId: a.shiftId,
          workDate: dateOnly(a.workDate),
          action: a.action,
          payload: { ...a, resultVersion: r.version ?? null } as unknown as Prisma.InputJsonValue,
          deviceRecordedAt: new Date(a.deviceRecordedAt),
          result: r.result,
          message: r.message ?? null,
          attendanceId: r.attendanceId ?? null,
        },
      });
      await this.audit.log(user, {
        action: `sync.${r.result.toLowerCase()}`,
        entity: 'OfflineSyncRecord',
        entityId: a.clientId,
        after: { action: a.action, employeeId: a.employeeId, workDate: a.workDate, deviceRecordedAt: a.deviceRecordedAt, message: r.message },
      });
      return r;
    };

    try {
      const current = await this.prisma.attendanceRecord.findUnique({
        where: { employeeId_shiftId_workDate: { employeeId: a.employeeId, shiftId: a.shiftId, workDate: dateOnly(a.workDate) } },
        include: { markedBy: { select: { fullName: true } } },
      });
      // Conflict detection
      let expected: number | null = a.baseVersion;
      if (a.prevClientId) {
        const prev = await this.prisma.offlineSyncRecord.findUnique({ where: { clientId: a.prevClientId } });
        if (!prev || prev.result !== 'SYNCED') {
          return store({ clientId: a.clientId, result: 'CONFLICT', message: 'An earlier offline entry for this employee was not applied' });
        }
        expected = (prev.payload as any)?.resultVersion ?? null;
      }
      const currentVersion = current?.version ?? null;
      if (currentVersion !== expected) {
        return store({
          clientId: a.clientId,
          result: 'CONFLICT',
          message: current
            ? `Changed on the server by ${current.markedBy?.fullName ?? 'another user'} while this device was offline`
            : 'Record was removed on the server',
          attendanceId: current?.id,
          server: current ? { status: current.status, checkInAt: current.checkInAt, checkOutAt: current.checkOutAt } : null,
        });
      }

      const slot = { siteId: a.siteId, shiftId: a.shiftId, workDate: a.workDate };
      const meta = { mode: 'OFFLINE' as const, deviceRecordedAt: new Date(a.deviceRecordedAt), offlineClientId: a.clientId };
      let saved: { id: string; version: number };
      if (a.action === 'MARK') {
        const res = await this.attendance.mark(user, slot, [{ employeeId: a.employeeId, status: a.status!, remarks: a.remarks }], meta);
        saved = res.records[0];
      } else if (a.action === 'CHECK_IN') {
        saved = await this.attendance.checkIn(user, slot, { employeeId: a.employeeId, time: a.time ?? a.deviceRecordedAt, remarks: a.remarks }, meta);
      } else {
        saved = await this.attendance.checkOut(user, slot, { employeeId: a.employeeId, time: a.time ?? a.deviceRecordedAt, remarks: a.remarks }, meta);
      }
      return store({ clientId: a.clientId, result: 'SYNCED', attendanceId: saved.id, version: saved.version });
    } catch (err: any) {
      const message = err?.response?.message ?? err?.message ?? 'Failed';
      const isConflict = err?.status === 409;
      return store({ clientId: a.clientId, result: isConflict ? 'CONFLICT' : 'FAILED', message: String(message) });
    }
  }

  async history(user: AuthUser) {
    return this.prisma.offlineSyncRecord.findMany({
      where: { organizationId: user.orgId, ...(user.role === 'SUPERVISOR' ? { userId: user.id } : {}) },
      orderBy: { syncedAt: 'desc' },
      take: 200,
    });
  }
}
