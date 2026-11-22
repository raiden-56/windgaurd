// Bundles the real API into a browser module worker (apps/web/public/demo/backend.js) for the static build.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const apiDir = resolve(here, '../api');
const outDir = resolve(here, '../web/public/demo');
const shim = (f) => resolve(here, 'src/shims', f);

// The API relies on emitDecoratorMetadata for dependency injection, which esbuild does not emit,
// so API sources go through the TypeScript compiler first.
const decorators = {
  name: 'ts-decorator-metadata',
  setup(build) {
    build.onLoad({ filter: /[\\/]apps[\\/]api[\\/](src|prisma)[\\/].*\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const out = ts.transpileModule(source, {
        fileName: args.path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS, // isolated transpiles keep type-only imports; CJS makes those harmless
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          useDefineForClassFields: false,
        },
      });
      return { contents: out.outputText, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

// Prisma's edge runtime does `x instanceof SharedArrayBuffer`, which throws where the page is not
// cross-origin isolated (GitHub Pages cannot send the COOP/COEP headers that enable it).
const sharedArrayBufferGuard = {
  name: 'shared-array-buffer-guard',
  setup(build) {
    build.onLoad({ filter: /wasm-compiler-edge\.m?js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const out = src.replaceAll('instanceof SharedArrayBuffer', 'instanceof (globalThis.SharedArrayBuffer ?? ArrayBuffer)');
      if (out === src) throw new Error('SharedArrayBuffer guard: pattern not found in ' + args.path);
      return { contents: out, loader: 'js' };
    });
  },
};

// Every migration's SQL, in order, plus a hash so a new schema gets a fresh browser database.
const migrationsPlugin = {
  name: 'migrations',
  setup(build) {
    build.onResolve({ filter: /^virtual:migrations$/ }, () => ({ path: 'migrations', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => {
      const dir = join(apiDir, 'prisma/migrations');
      const sql = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .map((name) => readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
      const hash = createHash('sha256').update(sql.join('\n')).digest('hex').slice(0, 10);
      return { contents: `export const migrations = ${JSON.stringify(sql)}; export const schemaHash = ${JSON.stringify(hash)};`, loader: 'js' };
    });
  },
};

// Exact module ids swapped for browser versions. Subpaths (e.g. @nestjs/core/services/…) are left alone.
const modules = {
  '@nestjs/core': shim('nest-core.ts'),
  '@nestjs/platform-express': shim('platform-express.ts'),
  '@nestjs/jwt': shim('jwt.ts'),
  '@nestjs/schedule': shim('schedule.ts'),
  '@prisma/adapter-pg': shim('adapter-pg.ts'),
  // Prisma's edge runtime has no Node dependencies; the generated client works with either.
  '@prisma/client/runtime/client': require.resolve('@prisma/client/runtime/wasm-compiler-edge'),
  'web-push': shim('web-push.ts'),
  bullmq: shim('bullmq.ts'),
  'class-validator': shim('empty-node.cjs'),
  'class-transformer': shim('empty-node.cjs'),
  exceljs: require.resolve('exceljs/dist/exceljs.min.js'),
  pdfkit: join(dirname(require.resolve('pdfkit')), 'pdfkit.standalone.js'),
  crypto: shim('crypto.ts'),
  process: shim('process.ts'),
  path: require.resolve('path-browserify'),
  buffer: require.resolve('buffer/'),
  events: require.resolve('events/'),
  util: shim('util.cjs'),
  stream: shim('stream.cjs'),
};
const redirect = {
  name: 'redirect',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const id = args.path.replace(/^node:/, '');
      if (modules[args.path]) return { path: modules[args.path] };
      if (args.path.startsWith('node:') || isBuiltin(args.path)) return { path: modules[id] ?? shim('empty-node.cjs') };
      return undefined;
    });
  },
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/worker.ts')],
  outfile: join(outDir, 'backend.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  metafile: true,
  legalComments: 'none',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import', 'default'],
  plugins: [redirect, sharedArrayBufferGuard, decorators, migrationsPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// PGlite loads its WebAssembly and data files relative to the bundle.
const pgliteDist = dirname(require.resolve('@electric-sql/pglite', { paths: [here] }));
for (const f of ['pglite.wasm', 'pglite.data', 'initdb.wasm']) {
  try {
    copyFileSync(join(pgliteDist, f), join(outDir, f));
  } catch {
    /* not every PGlite version ships every file */
  }
}

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`demo backend → ${outDir} (${(bytes / 1024 / 1024).toFixed(1)} MB JS)`);
if (process.argv.includes('--meta')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(here, 'meta.json'), JSON.stringify(result.metafile));
}
