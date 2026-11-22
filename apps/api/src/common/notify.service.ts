import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import type { Role } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  /** Same key for the same user is stored only once (prevents repeated alerts). */
  dedupeKey?: string;
}

@Injectable()
export class NotifyService implements OnModuleInit {
  private readonly logger = new Logger('Notify');
  private pushEnabled = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@windguard.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      this.pushEnabled = true;
    }
  }

  get pushPublicKey() {
    return this.pushEnabled ? process.env.VAPID_PUBLIC_KEY! : null;
  }

  async toUsers(orgId: string, userIds: string[], n: NotificationInput) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return 0;
    const res = await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        organizationId: orgId,
        userId,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        severity: n.severity ?? 'INFO',
        dedupeKey: n.dedupeKey ?? null,
      })),
      skipDuplicates: true,
    });
    if (res.count > 0) void this.push(ids, n);
    return res.count;
  }

  /** Admins of the organization plus (optionally) supervisors assigned to a site. */
  async recipients(orgId: string, opts: { roles?: Role[]; siteId?: string | null; includeSiteSupervisors?: boolean }) {
    const roles = opts.roles ?? ['COMPANY_ADMIN'];
    const admins = await this.prisma.user.findMany({
      where: { organizationId: orgId, isActive: true, role: { in: roles } },
      select: { id: true },
    });
    let sups: { id: string }[] = [];
    if (opts.includeSiteSupervisors && opts.siteId) {
      sups = await this.prisma.user.findMany({
        where: { isActive: true, role: 'SUPERVISOR', siteAssignments: { some: { siteId: opts.siteId } } },
        select: { id: true },
      });
    }
    return [...admins, ...sups].map((u) => u.id);
  }

  async toAdmins(orgId: string, n: NotificationInput, siteId?: string | null) {
    const ids = await this.recipients(orgId, { roles: ['COMPANY_ADMIN'], siteId });
    return this.toUsers(orgId, ids, n);
  }

  async toSiteSupervisors(orgId: string, siteId: string, n: NotificationInput) {
    const sups = await this.prisma.user.findMany({
      where: { organizationId: orgId, isActive: true, role: 'SUPERVISOR', siteAssignments: { some: { siteId } } },
      select: { id: true },
    });
    return this.toUsers(
      orgId,
      sups.map((s) => s.id),
      n,
    );
  }

  private async push(userIds: string[], n: NotificationInput) {
    if (!this.pushEnabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    const payload = JSON.stringify({ title: n.title, body: n.body, link: n.link ?? '/notifications' });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Push failed: ${err?.message}`);
          }
        }
      }),
    );
  }
}
