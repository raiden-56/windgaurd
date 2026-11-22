import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationSettings } from '../generated/prisma/client';
import { assertSite, AuthUser } from './context';
import { PrismaService } from './prisma.service';

export const DEFAULT_ABBREVIATIONS: Record<string, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LEAVE: 'L',
  HALF_DAY: 'H',
  WEEKLY_OFF: 'WO',
  HOLIDAY: 'PH',
  ON_DUTY: 'OD',
  INCOMPLETE: 'IC',
  PENDING: '?',
  NOT_SCHEDULED: '-',
};

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(orgId: string): Promise<OrganizationSettings> {
    const existing = await this.prisma.organizationSettings.findUnique({ where: { organizationId: orgId } });
    if (existing) return existing;
    return this.prisma.organizationSettings.create({
      data: { organizationId: orgId, abbreviations: DEFAULT_ABBREVIATIONS },
    });
  }

  async site(user: AuthUser, siteId: string) {
    assertSite(user, siteId);
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId: user.orgId } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async shift(user: AuthUser, shiftId: string, siteId?: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, organizationId: user.orgId } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (siteId && shift.siteId !== siteId) throw new ForbiddenException('Shift does not belong to this site');
    assertSite(user, shift.siteId);
    return shift;
  }

  async employee(user: AuthUser, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: user.orgId, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }
}
