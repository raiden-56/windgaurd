import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/client';
import type { Permission } from './permissions';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** Organization in effect for this request (super admins may switch). */
  orgId: string;
  homeOrgId: string;
  permissions: Set<Permission>;
  /** Site ids the user may access; null means every site in the organization. */
  siteIds: string[] | null;
  ip?: string;
  userAgent?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user!;
});

export function can(user: AuthUser, perm: Permission) {
  return user.permissions.has(perm);
}

export function assertSite(user: AuthUser, siteId: string | undefined | null) {
  if (!siteId) return;
  if (user.siteIds && !user.siteIds.includes(siteId)) {
    throw new ForbiddenException('You are not assigned to this site');
  }
}

/** Prisma filter restricting rows to the user's sites. */
export function siteScope(user: AuthUser, siteId?: string | null): { siteId?: string | { in: string[] } } {
  if (siteId) {
    assertSite(user, siteId);
    return { siteId };
  }
  return user.siteIds ? { siteId: { in: user.siteIds } } : {};
}
