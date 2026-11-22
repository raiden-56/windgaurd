import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/context';
import { GRANTABLE_EXTRAS, Perm } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { parse, z } from '../../common/zod';

const ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'SUPERVISOR', 'VIEWER'] as const;

function recoveryCode() {
  // 10 characters from an unambiguous alphabet, shown once to the administrator.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('users.read')
  async list(@CurrentUser() user: AuthUser, @Query('role') role?: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.orgId, ...(role ? { role: parse(z.enum(ROLES), role) } : {}) },
      include: {
        siteAssignments: { include: { site: { select: { id: true, name: true, code: true } } } },
        _count: { select: { passkeys: true, markedAttendance: true } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    const since = new Date(Date.now() - 30 * 86400_000);
    const registers = await this.prisma.attendanceRegister.groupBy({
      by: ['submittedById'],
      where: { organizationId: user.orgId, submittedAt: { gte: since } },
      _count: true,
    });
    const regMap = new Map(registers.map((r) => [r.submittedById, r._count]));
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      extraPermissions: u.extraPermissions,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      sites: u.siteAssignments.map((a) => ({ ...a.site, isPrimary: a.isPrimary })),
      passkeys: u._count.passkeys,
      recordsMarked: u._count.markedAttendance,
      registersSubmitted30d: regMap.get(u.id) ?? 0,
      hasPassword: !!u.passwordHash,
    }));
  }

  private guardRole(actor: AuthUser, role: (typeof ROLES)[number]) {
    if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only a super admin can create super admins');
  }

  @Post()
  @Perm('users.manage')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        fullName: z.string().trim().min(2).max(120),
        email: z.string().email().transform((s) => s.toLowerCase()),
        phone: z.string().regex(/^[0-9+\-\s]{7,16}$/, 'Invalid phone number').nullable().optional(),
        role: z.enum(ROLES),
        siteIds: z.array(z.string()).default([]),
        extraPermissions: z.array(z.enum(GRANTABLE_EXTRAS as [string, ...string[]])).default([]),
        password: z.string().min(10, 'Use at least 10 characters').optional(),
      }),
      body,
    );
    this.guardRole(user, p.role);
    if (await this.prisma.user.findUnique({ where: { email: p.email } })) throw new ConflictException('A user with this email already exists');
    await this.assertSites(user, p.siteIds);
    const code = p.password ? null : recoveryCode();
    const created = await this.prisma.user.create({
      data: {
        organizationId: user.orgId,
        fullName: p.fullName,
        email: p.email,
        phone: p.phone ?? null,
        role: p.role,
        extraPermissions: p.extraPermissions,
        passwordHash: p.password ? await bcrypt.hash(p.password, 10) : null,
        recoveryCodeHash: code ? await bcrypt.hash(code, 10) : null,
        recoveryExpires: code ? new Date(Date.now() + 72 * 3600_000) : null,
        siteAssignments: { create: p.siteIds.map((siteId, i) => ({ siteId, isPrimary: i === 0 })) },
      },
    });
    await this.audit.log(user, {
      action: 'user.create',
      entity: 'User',
      entityId: created.id,
      after: { fullName: p.fullName, email: p.email, role: p.role, siteIds: p.siteIds, extraPermissions: p.extraPermissions },
    });
    return { id: created.id, setupCode: code, setupCodeExpiresHours: code ? 72 : null };
  }

  private async assertSites(user: AuthUser, siteIds: string[]) {
    if (!siteIds.length) return;
    const count = await this.prisma.site.count({ where: { id: { in: siteIds }, organizationId: user.orgId } });
    if (count !== siteIds.length) throw new BadRequestException('One or more sites were not found');
  }

  @Patch(':id')
  @Perm('users.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(
      z.object({
        fullName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().regex(/^[0-9+\-\s]{7,16}$/, 'Invalid phone number').nullable().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
        siteIds: z.array(z.string()).optional(),
        extraPermissions: z.array(z.enum(GRANTABLE_EXTRAS as [string, ...string[]])).optional(),
      }),
      body,
    );
    const before = await this.prisma.user.findFirst({ where: { id, organizationId: user.orgId }, include: { siteAssignments: true } });
    if (!before) throw new NotFoundException('User not found');
    if (p.role) this.guardRole(user, p.role);
    if (before.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Cannot modify a super admin');
    if (id === user.id && (p.isActive === false || (p.role && p.role !== before.role))) {
      throw new BadRequestException('You cannot deactivate yourself or change your own role');
    }
    if (p.siteIds) await this.assertSites(user, p.siteIds);
    const { siteIds, ...data } = p;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { ...data, ...(p.isActive === false || p.role ? { sessionVersion: { increment: 1 } } : {}) },
      });
      if (siteIds) {
        await tx.supervisorSiteAssignment.deleteMany({ where: { userId: id, siteId: { notIn: siteIds } } });
        for (const [i, siteId] of siteIds.entries()) {
          await tx.supervisorSiteAssignment.upsert({
            where: { userId_siteId: { userId: id, siteId } },
            create: { userId: id, siteId, isPrimary: i === 0 },
            update: { isPrimary: i === 0 },
          });
        }
      }
      await this.audit.log(
        user,
        {
          action: 'user.update',
          entity: 'User',
          entityId: id,
          before: { fullName: before.fullName, role: before.role, isActive: before.isActive, extraPermissions: before.extraPermissions, siteIds: before.siteAssignments.map((s) => s.siteId) },
          after: p,
        },
        tx,
      );
    });
    return { ok: true };
  }

  /** Issues a one-time recovery code (secure alternative access when a passkey is lost). */
  @Post(':id/recovery-code')
  @HttpCode(200)
  @Perm('users.manage')
  async issueRecovery(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.orgId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Cannot reset a super admin');
    const code = recoveryCode();
    await this.prisma.user.update({
      where: { id },
      data: { recoveryCodeHash: await bcrypt.hash(code, 10), recoveryExpires: new Date(Date.now() + 24 * 3600_000) },
    });
    await this.audit.log(user, { action: 'user.recovery_code.issue', entity: 'User', entityId: id, reason: 'Access recovery' });
    return { code, expiresHours: 24 };
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  @Perm('users.manage')
  async revokeSessions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.orgId } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await this.audit.log(user, { action: 'user.sessions.revoke', entity: 'User', entityId: id });
    return { ok: true };
  }
}
