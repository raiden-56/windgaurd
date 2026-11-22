// Starts the local database, the API (watch mode) and the web app together.
import { spawn } from "node:child_process";

const procs = [];
const run = (name, cmd, args, color) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (s) => s.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag + l)));
  pipe(p.stdout);
  pipe(p.stderr);
  procs.push(p);
  return p;
};

run("db", "node", ["scripts/dev-db.mjs"], "36");
setTimeout(() => {
  run("api", "npm", ["run", "dev", "-w", "apps/api"], "35");
  run("web", "npm", ["run", "dev", "-w", "apps/web"], "34");
}, 4000);

const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
