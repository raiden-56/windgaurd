// Tiny static server for checking the GitHub Pages build locally, mounted under the same base path.
// Usage: node scripts/serve.mjs <dir> [basePath] [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../web/out');
const base = (process.argv[3] ?? '/windgaurd').replace(/\/$/, '');
const port = Number(process.argv[4] ?? 3200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function file(p) {
  for (const c of [p, `${p}.html`, join(p, 'index.html')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith(base)) {
    res.writeHead(302, { location: `${base}/` }).end();
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname.slice(base.length))).replace(/^([/\\])+/, '');
  let f = file(join(root, rel));
  let status = 200;
  if (!f) {
    f = file(join(root, '404.html'));
    status = 404;
  }
  if (!f) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(status, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(f).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}/`));
