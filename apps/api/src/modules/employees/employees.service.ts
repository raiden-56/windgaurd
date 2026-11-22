import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OrgService } from '../../common/org.service';
import type { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  /** Next auto-generated employee ID, e.g. EMP0143 (unique within the organization). */
  async nextCodes(orgId: string, count = 1, tx: Tx = this.prisma): Promise<string[]> {
    const s = await this.org.settings(orgId);
    const prefix = s.employeeIdPrefix;
    const rows = await tx.$queryRawUnsafe<{ max: number | null }[]>(
      `SELECT MAX(CAST(SUBSTRING("employeeCode" FROM $2::int) AS INTEGER)) AS max
         FROM "Employee"
        WHERE "organizationId" = $1 AND "employeeCode" ~ $3`,
      orgId,
      prefix.length + 1,
      `^${prefix.replace(/[^A-Za-z0-9]/g, '')}[0-9]+$`,
    );
    const start = (rows[0]?.max ?? 0) + 1;
    return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(s.employeeIdPadding, '0')}`);
  }

  async designationId(orgId: string, name: string | null | undefined, tx: Tx = this.prisma) {
    if (!name?.trim()) return null;
    const n = name.trim();
    const d = await tx.designation.upsert({
      where: { organizationId_name: { organizationId: orgId, name: n } },
      create: { organizationId: orgId, name: n },
      update: {},
    });
    return d.id;
  }

  async departmentId(orgId: string, name: string | null | undefined, tx: Tx = this.prisma) {
    if (!name?.trim()) return null;
    const n = name.trim();
    const d = await tx.department.upsert({
      where: { organizationId_name: { organizationId: orgId, name: n } },
      create: { organizationId: orgId, name: n },
      update: {},
    });
    return d.id;
  }
}
