import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export function postgresEnabled(): boolean {
  return Boolean(
    process.env.RESEARCH_DATABASE_URL || process.env.RESEARCH_DATABASE_HOST,
  );
}

export function databaseSchema(): string {
  const schema = process.env.RESEARCH_DATABASE_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("数据库命名空间无效");
  return schema;
}

let pool: Pool | undefined;
export function databasePool(): Pool {
  if (!postgresEnabled()) throw new Error("PostgreSQL 未配置");
  if (!pool) {
    pool = new Pool({
      ...(process.env.RESEARCH_DATABASE_URL
        ? { connectionString: process.env.RESEARCH_DATABASE_URL }
        : {
            host: process.env.RESEARCH_DATABASE_HOST,
            port: Number(process.env.RESEARCH_DATABASE_PORT || 15432),
            database: process.env.RESEARCH_DATABASE_NAME || "jiaoyan",
            user: process.env.RESEARCH_DATABASE_USER || "jiaoyan",
            password: process.env.RESEARCH_DATABASE_PASSWORD,
          }),
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      application_name: "jiaoyan-yueji",
      options: `-c search_path=${databaseSchema()},public`,
    });
    pool.on("error", () =>
      console.error("PostgreSQL 空闲连接已断开，将在下次请求重新连接。"),
    );
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return databasePool().query<T>(sql, params);
}

export async function withClient<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await databasePool().connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

export async function closePostgres(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}
