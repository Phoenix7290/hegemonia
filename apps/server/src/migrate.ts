import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

try {
  process.loadEnvFile?.();
} catch {
  try {
    process.loadEnvFile?.("../../.env");
  } catch {
    // Process env already set externally
  }
}

export async function runMigrations(direction: "up" | "down" = "up"): Promise<void> {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL é obrigatório.");
  }

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
}

const isDirectRun = Boolean(
  process.argv[1] && (
    fileURLToPath(import.meta.url) === process.argv[1] ||
    process.argv[1].endsWith("migrate.ts") ||
    process.argv[1].endsWith("migrate.js")
  )
);

if (isDirectRun) {
  const direction = process.argv[2] === "down" ? "down" : "up";
  await runMigrations(direction);
}
