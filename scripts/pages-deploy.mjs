// Builds the static site and publishes it to the gh-pages branch, which GitHub Pages serves.
// Locally it pushes with your normal git credentials; in GitHub Actions it uses GITHUB_TOKEN.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

if (!process.argv.includes('--skip-build')) sh('node scripts/pages-build.mjs');

const site = join('apps', 'web', 'out');
const remote = process.env.GITHUB_TOKEN
  ? `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`
  : out('git remote get-url origin');
const commit = out('git rev-parse --short HEAD');

// The built site gets its own throwaway repository; gh-pages always holds just the latest build.
rmSync(join(site, '.git'), { recursive: true, force: true });
sh('git init -q -b gh-pages', { cwd: site });
sh('git add -A', { cwd: site });
sh(`git -c user.name="WINDGUARD deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy ${commit}"`, { cwd: site });
sh(`git push --force "${remote}" gh-pages`, { cwd: site });
rmSync(join(site, '.git'), { recursive: true, force: true });
console.log('\nPublished to the gh-pages branch.');
