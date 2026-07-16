import { spawnSync } from "child_process";
import { assertDbPushAllowed, assertDisposableLocalDatabase } from "./dbLifecycle";
import { redactDatabaseUrl } from "./migrationSafety";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  npm run db:push -- --i-understand-this-destroys-disposable-local-state

This guard only permits drizzle-kit push against explicitly disposable local databases.
Production and cloud environments must use npm run db:migrate.`);
  process.exit(0);
}

try {
  assertDbPushAllowed(process.argv.slice(2), process.env);
  assertDisposableLocalDatabase(process.env.DATABASE_URL!);
  console.error(`WARNING: running drizzle-kit push against disposable local database ${redactDatabaseUrl(process.env.DATABASE_URL!)}`);
  const child = spawnSync("npx", ["drizzle-kit", "push"], { stdio: "inherit", env: process.env });
  process.exit(child.status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
