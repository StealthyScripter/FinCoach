import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const bundlePath = "dist/index.cjs";
if (!existsSync(bundlePath)) {
  console.log("production bundle certification skipped: dist/index.cjs is not built");
} else {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.doesNotMatch(bundle, /connect-pg-simple/i);
  assert.doesNotMatch(bundle, /table\.sql/i);
  assert.match(bundle, /auth_sessions/);
  assert.match(bundle, /headersSent/);

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("production bundle certification requires TEST_DATABASE_URL");
  } else {
    const schema = `bundle_cert_${process.pid}_${Date.now()}`.replace(/\W/g, "_");
    const scopedDatabaseUrl = withSearchPath(databaseUrl, schema);
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
      const scoped = new Client({ connectionString: scopedDatabaseUrl });
      await scoped.connect();
      try {
        for (const migration of allMigrationPaths()) {
          await scoped.query(readFileSync(migration, "utf8"));
        }
      } finally {
        await scoped.end();
      }

      await certifyBundleProcess(scopedDatabaseUrl);
      const rows = await queryScalar(scopedDatabaseUrl, "SELECT count(*)::int FROM auth_sessions");
      assert.equal(rows, 1);
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await admin.end();
    }
  }
  console.log("production bundle certification tests passed");
}

async function certifyBundleProcess(databaseUrl?: string) {
  const port = await freePort();
  const child = spawn(process.execPath, [bundlePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : { DATABASE_URL: "" }),
      FINCOACH_AUTH_ALLOWED_EMAILS: "bundle@example.com",
      PUBLIC_REGISTRATION_ENABLED: databaseUrl ? "true" : "false",
      FINCOACH_AUTH_REQUIRED: "true",
      FINCOACH_AUTH_SESSION_SECRET: "bundle-certification-session-secret",
      FINCOACH_AUTH_SECURE_COOKIE: "false",
      TELEGRAM_NOTIFICATIONS_ENABLED: "false",
      FINCOACH_TELEGRAM_COMMAND_POLLING_ENABLED: "false",
      FINCOACH_TELEGRAM_INBOUND_POLLING_ENABLED: "false",
      FINCOACH_TELEGRAM_LONG_POLLING_ENABLED: "false",
      FINCOACH_BUILD_COMMIT: "stale-pm2-env",
      FINCOACH_BUILD_ID: "stale-pm2-build",
      MARKETPILOT_DEMO_ONLY: "true",
      OANDA_ENV: "practice",
      BROKER_ENV: "",
      EXECUTION_MODE: "",
      MARKETPILOT_ALLOW_LIVE_EXECUTION: "",
      MARKETPILOT_ENABLE_LIVE_TRADING: "",
      MARKETPILOT_PRODUCTION_LIVE_EXECUTION: "",
      ENABLE_LIVE_TRADING: "",
      LIVE_TRADING_ENABLED: "",
      METATRADER_LIVE_BRIDGE_URL: "",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await waitForHttp(port, child, () => ({ stdout, stderr }));
    const healthStarted = Date.now();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthText = await health.text();
    assert.equal(health.status, 200);
    assert.ok(Date.now() - healthStarted < 1_500, "bundled public health should be bounded and cheap");
    assert.ok(Buffer.byteLength(healthText, "utf8") < 4096);
    const healthBody = JSON.parse(healthText);
    assert.equal(healthBody.deployedRevision.runtimeMetadataState, "stale");
    assert.equal(healthBody.deployedRevision.revisionMatch, false);
    assert.doesNotMatch(healthText, /pipeline|forwardTests|hypothesis_insufficient_independent_occurrences/);

    const diagnostics = await fetch(`http://127.0.0.1:${port}/api/health/diagnostics`);
    assert.equal(diagnostics.status, 401);

    const signup = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bundle@example.com", password: "StrongPassword123!" }),
    });
    assert.equal(signup.status, databaseUrl ? 201 : 403);
    if (databaseUrl) {
      const cookie = signup.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      const session = await fetch(`http://127.0.0.1:${port}/api/auth/session`, { headers: { cookie } });
      assert.equal(session.status, 200);
      assert.equal((await session.json()).authenticated, true);
    }
  } finally {
    await stop(child);
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

function allMigrationPaths() {
  return readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => `migrations/${name}`);
}

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(port: number, child: ChildProcessWithoutNullStreams, output: () => { stdout: string; stderr: string }) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const captured = output();
    assert.equal(child.exitCode, null, `bundle exited early (exitCode=${child.exitCode}, signal=${child.signalCode})\nSTDOUT:\n${captured.stdout}\nSTDERR:\n${captured.stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const captured = output();
  assert.fail(`bundle did not become ready (exitCode=${child.exitCode}, signal=${child.signalCode})\nSTDOUT:\n${captured.stdout}\nSTDERR:\n${captured.stderr}`);
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function queryScalar(connectionString: string, sql: string) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(sql);
    return Number(Object.values(result.rows[0])[0]);
  } finally {
    await client.end();
  }
}
