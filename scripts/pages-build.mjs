// Builds the static GitHub Pages site into apps/web/out:
// the in-browser API bundle (apps/demo) and a static export of the web app under the base path.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const env = { ...process.env, PAGES_BUILD: '1', PAGES_BASE_PATH: process.env.PAGES_BASE_PATH ?? '/windgaurd' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });

run('npm run build -w apps/demo');
run('npm run build -w apps/web');
// GitHub Pages runs Jekyll by default, which drops folders starting with "_" such as _next.
writeFileSync('apps/web/out/.nojekyll', '');
console.log(`\nStatic site ready in apps/web/out (base path ${env.PAGES_BASE_PATH})`);
