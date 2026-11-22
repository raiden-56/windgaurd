// Node globals the API code (and some of its libraries) expect. Imported first by the worker entry.
import { Buffer } from 'buffer';

const g = globalThis as any;
g.global ??= g;
g.Buffer ??= Buffer;
g.setImmediate ??= (fn: (...a: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
g.clearImmediate ??= (id: number) => clearTimeout(id);

const origin: string = g.location?.origin ?? 'http://localhost';
g.process ??= {
  env: {},
  cwd: () => '/',
  platform: 'browser',
  version: 'v20.0.0',
  versions: {},
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  emitWarning: () => undefined,
  on: () => undefined,
  stdout: { write: (s: string) => console.log(s) },
  stderr: { write: (s: string) => console.error(s) },
};
Object.assign(g.process.env, {
  NODE_ENV: 'demo',
  JWT_SECRET: 'browser-demo',
  RP_ID: g.location?.hostname ?? 'localhost',
  RP_NAME: 'WINDGUARD',
  WEB_ORIGIN: origin,
});
