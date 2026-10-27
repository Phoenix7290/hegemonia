import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL é obrigatório.");
}

const direction = process.argv[2] === "down" ? "down" : "up";
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

await runner({
  databaseUrl,
  dir: migrationsDir,
  migrationsTable: "schema_migrations",
  direction,
  count: direction === "down" ? 1 : undefined,
  checkOrder: true,
  advisoryLockMode: "wait",
  singleTransaction: true,
  log: (message) => console.log(message),
});
