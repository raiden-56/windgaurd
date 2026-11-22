import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../../common/notify.service';
import { OrgService } from '../../common/org.service';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../../common/queue.service';
import { addDays, dateKey, dateOnly, shiftWindow, todayIn } from '../../common/time';

/**
 * Periodic operational checks that raise notifications:
 * attendance not completed, missing check-outs (records flagged INCOMPLETE),
 * understaffed shifts and handovers awaiting confirmation.
 */
@Injectable()
export class SweepService implements OnModuleInit {
  private readonly logger = new Logger('Sweep');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.queue.register('operational-sweep', () => this.run());
  }

  @Interval(10 * 60_000)
  async tick() {
    await this.queue.enqueue('operational-sweep', {});
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
      for (const o of orgs) await this.sweepOrg(o.id);
    } catch (err: any) {
      this.logger.error(err.message);
    } finally {
      this.running = false;
    }
  }

  private async sweepOrg(orgId: string) {
    const settings = await this.org.settings(orgId);
    const sites = await this.prisma.site.findMany({ where: { organizationId: orgId, isActive: true }, include: { shifts: { where: { isActive: true } } } });
    const now = Date.now();
    for (const site of sites) {
      const today = todayIn(site.timezone);
      for (const day of [addDays(today, -1), today]) {
        for (const shift of site.shifts) {
          const w = shiftWindow(day, shift, site.timezone);
          if (now < w.start.getTime()) continue;
          const [roster, recs] = await Promise.all([
            this.prisma.rosterEntry.findMany({ where: { shiftId: shift.id, workDate: dateOnly(day) }, select: { employeeId: true } }),
            this.prisma.attendanceRecord.findMany({ where: { shiftId: shift.id, workDate: dateOnly(day) } }),
          ]);
          const marked = new Set(recs.map((r) => r.employeeId));
          const unmarked = roster.filter((r) => !marked.has(r.employeeId)).length;
          const label = `${site.name} · ${shift.name} · ${day}`;
          const link = `/attendance?site=${site.id}&shift=${shift.id}&date=${day}`;

          if (unmarked > 0 && now > w.start.getTime() + 60 * 60_000) {
            await this.notify.toSiteSupervisors(orgId, site.id, {
              type: 'attendance.not_completed',
              title: 'Attendance not completed',
              body: `${unmarked} rostered employee(s) are not marked for ${label}.`,
              link,
              severity: 'WARNING',
              dedupeKey: `not-completed:${shift.id}:${day}`,
            });
          }
          if (day === today && roster.length < shift.requiredWorkers) {
            await this.notify.toAdmins(orgId, {
              type: 'shift.unassigned',
              title: 'Shift understaffed',
              body: `${label}: ${roster.length} of ${shift.requiredWorkers} required positions assigned.`,
              link: '/shifts?tab=roster',
              severity: 'WARNING',
              dedupeKey: `understaffed:${shift.id}:${day}`,
            });
          }
          const overdue = recs.filter((r) => r.status === 'ON_DUTY' && !r.checkOutAt && now > r.scheduledEnd.getTime() + settings.incompleteAfterHours * 3600_000);
          if (overdue.length) {
            await this.prisma.attendanceRecord.updateMany({ where: { id: { in: overdue.map((o) => o.id) } }, data: { status: 'INCOMPLETE', version: { increment: 1 } } });
            await this.audit.logMany(
              null,
              overdue.map((o) => ({ orgId, action: 'attendance.mark_incomplete', entity: 'AttendanceRecord', entityId: o.id, before: { status: 'ON_DUTY' }, after: { status: 'INCOMPLETE' }, reason: 'No check-out recorded' })),
            );
            const ids = await this.notify.recipients(orgId, { roles: ['COMPANY_ADMIN'], siteId: site.id, includeSiteSupervisors: true });
            await this.notify.toUsers(orgId, ids, {
              type: 'attendance.missing_checkout',
              title: 'Missing check-out',
              body: `${overdue.length} employee(s) on ${label} were not checked out.`,
              link,
              severity: 'CRITICAL',
              dedupeKey: `missing-checkout:${shift.id}:${day}`,
            });
          }
        }
      }
    }
    const staleHandovers = await this.prisma.shiftHandover.findMany({
      where: { organizationId: orgId, status: 'PENDING', handoverAt: { lt: new Date(now - 60 * 60_000) } },
      include: { site: true, shift: true },
    });
    for (const h of staleHandovers) {
      const ids = h.incomingSupervisorId ? [h.incomingSupervisorId] : await this.notify.recipients(orgId, { roles: ['COMPANY_ADMIN'] });
      await this.notify.toUsers(orgId, ids, {
        type: 'handover.pending',
        title: 'Shift handover still pending',
        body: `${h.site.name} · ${h.shift.name} (${dateKey(h.workDate)}) handover from ${h.outgoingName} is not confirmed.`,
        link: '/shifts?tab=handover',
        severity: 'WARNING',
        dedupeKey: `handover-stale:${h.id}`,
      });
    }
  }
}
