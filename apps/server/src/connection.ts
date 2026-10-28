import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

try {
  process.loadEnvFile?.();
} catch {
  try {
    process.loadEnvFile?.("../../.env");
  } catch {
    // Process env already set externally
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL é obrigatório para a persistência PostgreSQL.");
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5000),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 10000),
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15000),
  query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 15000),
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined,
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<void> {
  await query("SELECT 1");
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
