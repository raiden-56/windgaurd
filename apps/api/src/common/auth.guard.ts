import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthUser } from './context';
import { Permission, permissionsFor, PERM_KEY, PUBLIC_KEY } from './permissions';
import { PrismaService } from './prisma.service';

export const SESSION_COOKIE = 'wg_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in');

    let payload: { sub: string; v: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { siteAssignments: { select: { siteId: true } } },
    });
    if (!user || !user.isActive || user.sessionVersion !== payload.v) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 120_000) {
      void this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }

    let orgId = user.organizationId;
    const requestedOrg = req.header('x-org-id');
    if (user.role === 'SUPER_ADMIN' && requestedOrg && requestedOrg !== orgId) {
      const exists = await this.prisma.organization.findUnique({ where: { id: requestedOrg }, select: { id: true } });
      if (exists) orgId = requestedOrg;
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      orgId,
      homeOrgId: user.organizationId,
      permissions: permissionsFor(user.role, user.extraPermissions),
      siteIds: user.role === 'SUPERVISOR' ? user.siteAssignments.map((a) => a.siteId) : null,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress,
      userAgent: req.header('user-agent'),
    };

    const required = this.reflector.getAllAndOverride<Permission[]>(PERM_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (required?.length) {
      const missing = required.filter((p) => !req.user!.permissions.has(p));
      if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
