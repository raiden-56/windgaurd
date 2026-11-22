import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/client';

export const PERMISSIONS = [
  'organizations.manage',
  'settings.manage',
  'sites.read',
  'sites.manage',
  'users.read',
  'users.manage',
  'employees.read',
  'employees.write',
  'employees.import',
  'shifts.read',
  'shifts.manage',
  'roster.read',
  'roster.manage',
  'attendance.read',
  'attendance.mark',
  'attendance.approve',
  'attendance.editHistorical',
  'corrections.request',
  'corrections.approve',
  'handover.write',
  'reports.read',
  'reports.export',
  'audit.read',
  'gate.read',
  'gate.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => p !== 'organizations.manage');

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  COMPANY_ADMIN: ADMIN,
  SUPERVISOR: [
    'sites.read',
    'employees.read',
    'shifts.read',
    'roster.read',
    'attendance.read',
    'attendance.mark',
    'corrections.request',
    'handover.write',
    'reports.read',
    'reports.export',
    'gate.read',
    'gate.write',
  ],
  VIEWER: [
    'sites.read',
    'users.read',
    'employees.read',
    'shifts.read',
    'roster.read',
    'attendance.read',
    'reports.read',
    'reports.export',
    'audit.read',
    'gate.read',
  ],
};

/** Grants a supervisor may receive on top of their role ("where authorized"). */
export const GRANTABLE_EXTRAS: Permission[] = ['roster.manage', 'attendance.editHistorical'];

export function permissionsFor(role: Role, extras: string[]): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const e of extras) if ((GRANTABLE_EXTRAS as string[]).includes(e)) set.add(e as Permission);
  return set;
}

export const PERM_KEY = 'wg:perm';
export const PUBLIC_KEY = 'wg:public';
/** Require every listed permission. */
export const Perm = (...perms: Permission[]) => SetMetadata(PERM_KEY, perms);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
