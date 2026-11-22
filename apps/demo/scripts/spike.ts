import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../../api/src/generated/prisma/client';
import { seedDatabase } from '../../api/prisma/seed-data';

async function run() {
  const t0 = Date.now();
  const pg = await PGlite.create();
  const dir = join(__dirname, '../../api/prisma/migrations');
  for (const m of readdirSync(dir).filter((d) => !d.endsWith('.toml')).sort()) {
    await pg.exec(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
  }
  console.log('migrated', Date.now() - t0, 'ms');
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  const t1 = Date.now();
  await seedDatabase(prisma);
  console.log('seeded', Date.now() - t1, 'ms');
  console.log(await prisma.attendanceRecord.count(), 'attendance records');
  try { await pg.exec(`UPDATE "AuditLog" SET action='x'`); console.log('TRIGGER FAILED'); } catch (e: any) { console.log('audit trigger ok:', e.message.slice(0, 60)); }
}
run();
