// Production-style local run: database + built API + built web app (run `npm run build` first).
import { spawn } from "node:child_process";

const procs = [];
const run = (name, cmd, args, color, cwd) => {
  const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: { ...process.env } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (s) => s.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag + l)));
  pipe(p.stdout);
  pipe(p.stderr);
  procs.push(p);
};
if (!process.env.SKIP_LOCAL_DB) run("db", "node", ["scripts/dev-db.mjs"], "36");
setTimeout(() => {
  run("api", "node", ["dist/main.js"], "35", "apps/api");
  run("web", "npm", ["run", "start"], "34", "apps/web");
}, process.env.SKIP_LOCAL_DB ? 0 : 4000);
const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
