import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { AuthService, configureAuth, PgAuthRepository, registerAuthRoutes } from "./auth/service";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log("auth session persistence PostgreSQL tests skipped: TEST_DATABASE_URL is not set");
} else {
  const schema = `auth_session_test_${process.pid}_${Date.now()}`.replace(/\W/g, "_");
  const scopedDatabaseUrl = withSearchPath(databaseUrl, schema);
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    const scoped = new Client({ connectionString: scopedDatabaseUrl });
    await scoped.connect();
    try {
      await scoped.query(readFileSync("migrations/0020_auth_and_portfolio_platform.sql", "utf8"));
      await scoped.query(readFileSync("migrations/0023_auth_sessions.sql", "utf8"));
    } finally {
      await scoped.end();
    }

    const previous = snapshotEnv([
      "DATABASE_URL",
      "FINCOACH_AUTH_ALLOWED_EMAILS",
      "FINCOACH_AUTH_REQUIRED",
      "FINCOACH_AUTH_SESSION_SECRET",
      "FINCOACH_AUTH_SECURE_COOKIE",
      "NODE_ENV",
    ]);
    process.env.DATABASE_URL = scopedDatabaseUrl;
    process.env.FINCOACH_AUTH_ALLOWED_EMAILS = "operator@example.com";
    process.env.FINCOACH_AUTH_REQUIRED = "true";
    process.env.FINCOACH_AUTH_SESSION_SECRET = "stable-test-session-secret";
    process.env.FINCOACH_AUTH_SECURE_COOKIE = "false";
    process.env.NODE_ENV = "test";

    const repository = new PgAuthRepository(scopedDatabaseUrl);
    const service = new AuthService(repository, process.env);
    const app = express();
    app.use(express.json());
    configureAuth(app);
    registerAuthRoutes(app, service);
    const server = createServer(app);
    await listen(server);
    try {
      const created = await post(server, "/api/auth/signup", { email: "operator@example.com", password: "StrongPassword123!" });
      assert.equal(created.status, 201);
      const createdBody = await created.json();
      assert.equal(createdBody.user.email, "operator@example.com");
      assert.ok(createdBody.csrfToken);
      const signupCookie = cookieHeader(created);
      assert.match(signupCookie, /fincoach\.sid=/);
      assert.equal(await sessionRowCount(scopedDatabaseUrl), 1);

      const signedOut = await post(server, "/api/auth/signout", {}, signupCookie, createdBody.csrfToken);
      assert.equal(signedOut.status, 200);
      assert.equal(await sessionRowCount(scopedDatabaseUrl), 0);

      const signedIn = await post(server, "/api/auth/signin", { email: "operator@example.com", password: "StrongPassword123!" });
      assert.equal(signedIn.status, 200);
      const signinBody = await signedIn.json();
      assert.equal(signinBody.user.email, "operator@example.com");
      const signinCookie = cookieHeader(signedIn);
      assert.match(signinCookie, /fincoach\.sid=/);
      assert.equal(await sessionRowCount(scopedDatabaseUrl), 1);

      const recovered = await get(server, "/api/auth/session", signinCookie);
      assert.equal(recovered.status, 200);
      const recoveredBody = await recovered.json();
      assert.equal(recoveredBody.authenticated, true);
      assert.equal(recoveredBody.user.email, "operator@example.com");
      assert.equal(recoveredBody.csrfToken, signinBody.csrfToken);

      const unauthorized = await get(server, "/api/auth/session");
      assert.equal(unauthorized.status, 401);
      assert.deepEqual(await unauthorized.json(), { authenticated: false });

      const rejected = await post(server, "/api/auth/signin", { email: "outsider@example.com", password: "StrongPassword123!" });
      assert.equal(rejected.status, 401);
      assert.equal(await sessionRowCount(scopedDatabaseUrl), 1);
    } finally {
      await close(server);
      await repository.close();
      restoreEnv(previous);
    }
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await admin.end();
  }

  assert.throws(() => {
    const previous = snapshotEnv(["DATABASE_URL", "FINCOACH_AUTH_SESSION_SECRET", "NODE_ENV"]);
    try {
      delete process.env.DATABASE_URL;
      delete process.env.FINCOACH_AUTH_SESSION_SECRET;
      process.env.NODE_ENV = "production";
      configureAuth(express());
    } finally {
      restoreEnv(previous);
    }
  }, /FINCOACH_AUTH_SESSION_SECRET is required in production/);

  console.log("auth session persistence PostgreSQL tests passed");
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function appUrl(server: ReturnType<typeof createServer>, path: string) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}${path}`;
}

function post(server: ReturnType<typeof createServer>, path: string, body: unknown, cookie?: string, csrfToken?: string) {
  return fetch(appUrl(server, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { "x-fincoach-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(server: ReturnType<typeof createServer>, path: string, cookie?: string) {
  return fetch(appUrl(server, path), {
    headers: cookie ? { cookie } : undefined,
  });
}

function cookieHeader(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function sessionRowCount(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query("SELECT count(*)::int AS count FROM auth_sessions");
    return Number(result.rows[0].count);
  } finally {
    await client.end();
  }
}

function withSearchPath(connectionString: string, schema: string) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function snapshotEnv(keys: string[]) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const [key, value] of snapshot.entries()) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
