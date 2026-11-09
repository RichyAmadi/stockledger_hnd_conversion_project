import { Pool, PoolClient } from "pg";

export const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST ?? "localhost",
        port: Number(process.env.PGPORT ?? 5432),
        database: process.env.PGDATABASE ?? "sims",
        user: process.env.PGUSER ?? "app_user",
        password: process.env.PGPASSWORD ?? "app_pass",
      }),
  max: Number(process.env.PGPOOL ?? 20),
});

/** Run fn inside a transaction whose RLS context is bound to one tenant. */
export async function withTenant<T>(businessId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.business_id', $1, true)", [businessId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
