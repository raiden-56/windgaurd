// Local development only: runs a self-contained PostgreSQL cluster in ./.devdb so
// WINDGUARD can be developed without Docker or a system-wide Postgres password.
// Production should point DATABASE_URL at a managed PostgreSQL instance.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../.devdb");
const port = Number(process.env.DEV_DB_PORT ?? 54331);
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "windguard",
  password: "windguard-local-dev",
  port,
  persistent: true,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("windguard");

console.log(`[db] PostgreSQL ready on port ${port}`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
