import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

export type AppDatabase = NodePgDatabase<typeof schema>;

export function createDatabase(databaseUrl = process.env.DATABASE_URL): AppDatabase {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL storage");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}
