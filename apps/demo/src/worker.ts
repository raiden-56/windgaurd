/**
 * WINDGUARD browser backend. Runs the real API (controllers, services, attendance engine,
 * audit trigger) against PGlite — PostgreSQL compiled to WebAssembly — persisted in this
 * browser's IndexedDB. Used by the static GitHub Pages build; each visitor gets a private copy.
 */
import './globals';
import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { migrations, schemaHash } from 'virtual:migrations';
import { seedDatabase } from '../../api/prisma/seed-data';
import { AppModule } from '../../api/src/app.module';
import { AuthGuard } from '../../api/src/common/auth.guard';
import { PrismaService } from '../../api/src/common/prisma.service';
import { PrismaClient } from '../../api/src/generated/prisma/client';
import { singleConnectionClient } from './pglite-client';
import { Reflector } from './shims/nest-core';
import { Container, Router, type DemoRequest } from './runtime';

const DB_PREFIX = 'windguard-demo';
const dbName = `${DB_PREFIX}-${schemaHash}`;

type Inbound =
  | { kind: 'request'; id: number; request: DemoRequest }
  | { kind: 'reset'; id: number }
  | { kind: 'info'; id: number }
  | { kind: 'takeover'; id?: number };

const status = (phase: string) => self.postMessage({ kind: 'status', phase });

let pg: PGlite;
let prisma: PrismaClient;

async function removeOldDatabases() {
  const list = (await indexedDB.databases?.()) ?? [];
  for (const d of list) {
    if (d.name && d.name.includes(DB_PREFIX) && !d.name.endsWith(dbName)) indexedDB.deleteDatabase(d.name);
  }
}

async function ensureMeta() {
  await pg.exec(`CREATE SCHEMA IF NOT EXISTS demo; CREATE TABLE IF NOT EXISTS demo.meta (key text PRIMARY KEY, value text NOT NULL)`);
  const rows = await pg.query<{ key: string; value: string }>(`SELECT key, value FROM demo.meta`);
  return Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
}

async function seed() {
  status('Generating demo data (about 4 months of attendance)…');
  await seedDatabase(prisma);
  await pg.query(`INSERT INTO demo.meta (key, value) VALUES ('seededAt', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [new Date().toISOString()]);
  await pg.syncToFs();
}

function deleteIdb(name: string) {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

async function openDatabase(memory: boolean) {
  pg = await PGlite.create(memory ? undefined : `idb://${dbName}`, { relaxedDurability: true });
  const meta = await ensureMeta();
  if (!meta.migrated) {
    status('Creating tables…');
    // One transaction: an interrupted first visit leaves no half-created schema behind.
    await pg.transaction(async (tx) => {
      for (const sql of migrations) await tx.exec(sql);
      await tx.query(`INSERT INTO demo.meta (key, value) VALUES ('migrated', $1)`, [schemaHash]);
    });
  }
  prisma = new PrismaClient({ adapter: new PrismaPGlite(singleConnectionClient(pg)) as any });
  // seededAt is written last, so an interrupted seed is simply redone (the seed truncates first).
  if (!meta.seededAt) await seed();
  await pg.syncToFs();
}

/**
 * One tab at a time owns the database: two PGlite instances on the same IndexedDB store
 * would corrupt it. Another tab can take over, which shuts this one down.
 */
const LOCK = `${DB_PREFIX}-owner`;
function acquireLock(steal: boolean) {
  const locks = (navigator as any).locks;
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    // Wait briefly when not stealing: after a reload the previous page's worker may still be shutting down.
    const opts = steal ? { steal: true } : { signal: AbortSignal.timeout(4000) };
    let granted = false;
    locks
      .request(LOCK, opts, () => {
        granted = true;
        resolve(true);
        return new Promise(() => undefined);
      })
      .catch(() => {
        if (!granted) {
          resolve(false); // timed out waiting: another tab is using the demo
          return;
        }
        // Lock stolen by another tab: stop touching the database.
        self.postMessage({ kind: 'stolen' });
        void pg?.close().catch(() => undefined);
        self.close();
      });
  });
}

let takeover: () => void = () => undefined;

async function boot() {
  const params = new URLSearchParams(self.location.search);
  if (!(await acquireLock(params.has('takeover')))) {
    self.postMessage({ kind: 'busy' });
    await new Promise<void>((r) => (takeover = r));
    await acquireLock(true);
  }
  status('Starting the in-browser database…');
  void removeOldDatabases().catch(() => undefined);
  const memory = params.has('memory');
  (globalThis as any).__demoDebug = params.has('debug');
  try {
    await openDatabase(memory);
  } catch (err) {
    if (memory) throw err;
    // A database left unusable (e.g. by an older build or a crash) is rebuilt from scratch.
    console.warn('[demo worker] rebuilding the browser database:', err);
    status('Rebuilding the in-browser database…');
    await pg?.close().catch(() => undefined);
    const list = (await indexedDB.databases?.()) ?? [];
    await Promise.all(list.filter((d) => d.name?.includes(dbName)).map((d) => deleteIdb(d.name!)));
    await deleteIdb(`/pglite/${dbName}`);
    await openDatabase(false);
  }

  const container = new Container([
    [PrismaService, prisma],
    [Reflector, new Reflector()],
  ]);
  container.load(AppModule);
  await container.init();
  return new Router(container, container.get(AuthGuard));
}

const ready = boot();
ready.then(
  () => self.postMessage({ kind: 'ready' }),
  (err) => {
    console.error(err);
    self.postMessage({ kind: 'fatal', message: String(err?.message ?? err) });
  },
);

let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (msg.kind === 'takeover') {
    takeover();
    return;
  }
  // PGlite is single-connection; Prisma transactions must not interleave, so requests run one at a time.
  chain = chain.then(async () => {
    try {
      const router = await ready;
      if (msg.kind === 'request') {
        const response = await router.handle(msg.request);
        const transfer = response.body instanceof ArrayBuffer ? [response.body] : [];
        self.postMessage({ kind: 'response', id: msg.id, response }, { transfer });
      } else if (msg.kind === 'reset') {
        await seed();
        self.postMessage({ kind: 'response', id: msg.id, response: { ok: true } });
      } else if (msg.kind === 'info') {
        const meta = await ensureMeta();
        self.postMessage({ kind: 'response', id: msg.id, response: { seededAt: meta.seededAt ?? null } });
      }
    } catch (err: any) {
      console.error(err);
      self.postMessage({ kind: 'response', id: msg.id, error: String(err?.message ?? err) });
    }
  });
};

self.addEventListener('unhandledrejection', (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  console.error('[demo worker] unhandled rejection', r?.stack ?? r, r?.errno, r?.code);
});

// Errors from abandoned work (e.g. closing a database being rebuilt) must not reach the page as fatal.
self.addEventListener('error', (e) => {
  console.error('[demo worker]', e.message);
  e.preventDefault();
});
