import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { AuthUser } from './context';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  orgId?: string;
}

/** Strips undefined and converts Dates/BigInts so values are JSON-safe. */
function clean(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(user: AuthUser | null, entry: AuditEntry, tx: Tx = this.prisma) {
    const orgId = entry.orgId ?? user?.orgId;
    if (!orgId) return;
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        userId: user?.id ?? null,
        userName: user?.fullName ?? 'System',
        userRole: user?.role ?? 'SYSTEM',
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        previousValues: clean(entry.before),
        newValues: clean(entry.after),
        reason: entry.reason ?? null,
        ipAddress: user?.ip ?? null,
        userAgent: user?.userAgent?.slice(0, 300) ?? null,
      },
    });
  }

  async logMany(user: AuthUser | null, entries: AuditEntry[], tx: Tx = this.prisma) {
    if (!entries.length) return;
    await tx.auditLog.createMany({
      data: entries.map((entry) => ({
        organizationId: (entry.orgId ?? user?.orgId)!,
        userId: user?.id ?? null,
        userName: user?.fullName ?? 'System',
        userRole: user?.role ?? 'SYSTEM',
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        previousValues: clean(entry.before),
        newValues: clean(entry.after),
        reason: entry.reason ?? null,
        ipAddress: user?.ip ?? null,
        userAgent: user?.userAgent?.slice(0, 300) ?? null,
      })),
    });
  }
}
