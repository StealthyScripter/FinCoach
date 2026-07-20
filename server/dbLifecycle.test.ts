import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { assertDbPushAllowed, assertDisposableLocalDatabase, readChecksumFile, resolvePostgresTools, sha256File, verifyBackupArtifact } from "../scripts/db/dbLifecycle";

const root = "/tmp/fincoach-db-lifecycle-test";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const sample = join(root, "sample.dump");
writeFileSync(sample, "not a real pg custom archive");
writeFileSync(`${sample}.sha256`, `${sha256File(sample)}  sample.dump\n`);

assert.equal(readChecksumFile(`${sample}.sha256`), sha256File(sample));
assert.throws(() => readChecksumFile(join(root, "missing.sha256")), /ENOENT/);

assert.doesNotThrow(() => assertDisposableLocalDatabase("postgres://user:secret@localhost:5432/fincoach_test"));
assert.doesNotThrow(() => assertDisposableLocalDatabase("postgres://user:secret@127.0.0.1:5432/disposable_fincoach"));
assert.throws(() => assertDisposableLocalDatabase("postgres://user:secret@db.example.com:5432/fincoach_test"), /not recognized/);
assert.throws(() => assertDisposableLocalDatabase("postgres://user:secret@localhost:5432/fincoach_prod"), /not marked disposable/);
assert.throws(() => assertDisposableLocalDatabase("not a url"), /malformed/);

assert.throws(() => assertDbPushAllowed([], {}), /disabled by default/);
assert.throws(
  () => assertDbPushAllowed(["--i-understand-this-destroys-disposable-local-state"], {
    FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH: "true",
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@localhost:5432/fincoach_test",
  }),
  /production/
);
assert.throws(
  () => assertDbPushAllowed([], {
    FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH: "true",
    DATABASE_URL: "postgres://u:p@localhost:5432/fincoach_test",
  }),
  /requires/
);
assert.doesNotThrow(() => assertDbPushAllowed(["--i-understand-this-destroys-disposable-local-state"], {
  FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH: "true",
  DATABASE_URL: "postgres://u:p@localhost:5432/fincoach_test",
}));

function commandRunner(versions: Record<string, string>, dockerPs = "fincoach-postgres postgres:15 healthy\n") {
  const calls: string[] = [];
  const run = (command: string, args: string[]) => {
    calls.push([command, ...args].join(" "));
    const key = [command, ...args].join(" ");
    if (command === "docker" && args[0] === "ps") return { status: 0, stdout: dockerPs, stderr: "" };
    const version = versions[key] ?? versions[command];
    if (!version) return { status: 1, stdout: "", stderr: "not found" };
    return { status: 0, stdout: version, stderr: "" };
  };
  return { run, calls };
}

{
  const fake = commandRunner({
    pg_dump: "pg_dump (PostgreSQL) 16.14",
    pg_restore: "pg_restore (PostgreSQL) 16.14",
    "docker exec fincoach-postgres pg_dump --version": "pg_dump (PostgreSQL) 15.9",
    "docker exec fincoach-postgres pg_restore --version": "pg_restore (PostgreSQL) 15.9",
  });
  const selected = await resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, { runCommand: fake.run as never, env: {} as NodeJS.ProcessEnv });
  assert.equal(selected.mode, "host");
  assert.equal(selected.clientMajor, 16);
  assert.equal(selected.restoreBin, "pg_restore");
  assert.ok(!fake.calls.some((call) => call.includes("docker exec")), "compatible host tools should prevent Docker client probing");
}

{
  const fake = commandRunner({
    "/tmp/pg tools/pg_dump": "pg_dump (PostgreSQL) 16.14",
    "/tmp/pg tools/pg_restore": "pg_restore (PostgreSQL) 16.14",
  });
  const selected = await resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, {
    runCommand: fake.run as never,
    env: { FINCOACH_PG_DUMP_BIN: "/tmp/pg tools/pg_dump", FINCOACH_PG_RESTORE_BIN: "/tmp/pg tools/pg_restore" } as NodeJS.ProcessEnv,
  });
  assert.equal(selected.mode, "host");
  assert.equal(selected.explicit, true);
  assert.equal(selected.dumpBin, "/tmp/pg tools/pg_dump");
  assert.equal(selected.restoreBin, "/tmp/pg tools/pg_restore");
}

{
  const fake = commandRunner({
    pg_dump: "pg_dump (PostgreSQL) 17.1",
    pg_restore: "pg_restore (PostgreSQL) 17.1",
    "docker exec fincoach-postgres pg_dump --version": "pg_dump (PostgreSQL) 15.9",
    "docker exec fincoach-postgres pg_restore --version": "pg_restore (PostgreSQL) 15.9",
  });
  const selected = await resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, { runCommand: fake.run as never, env: {} as NodeJS.ProcessEnv });
  assert.equal(selected.mode, "host");
  assert.ok(!fake.calls.some((call) => call.includes("docker exec")));
}

{
  const fake = commandRunner({
    pg_dump: "pg_dump (PostgreSQL) 15.9",
    pg_restore: "pg_restore (PostgreSQL) 15.9",
    "docker exec explicit-pg pg_dump --version": "pg_dump (PostgreSQL) 16.14",
    "docker exec explicit-pg pg_restore --version": "pg_restore (PostgreSQL) 16.14",
  });
  const selected = await resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, {
    runCommand: fake.run as never,
    env: { FINCOACH_POSTGRES_CONTAINER: "explicit-pg" } as NodeJS.ProcessEnv,
  });
  assert.equal(selected.mode, "docker");
  assert.equal(selected.container, "explicit-pg");
  assert.equal(selected.explicit, true);
}

{
  const fake = commandRunner({ pg_dump: "pg_dump (PostgreSQL) 15.9", pg_restore: "pg_restore (PostgreSQL) 15.9" }, "");
  await assert.rejects(
    () => resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, { runCommand: fake.run as never, env: {} as NodeJS.ProcessEnv }),
    /host PostgreSQL client is older than server/,
  );
}

{
  const fake = commandRunner({}, "");
  await assert.rejects(
    () => resolvePostgresTools("postgres://u:p@localhost:5432/fincoach", async () => 160014, { runCommand: fake.run as never, env: {} as NodeJS.ProcessEnv }),
    /no suitable PostgreSQL client/,
  );
}

{
  const toolDir = join(root, "pg tools");
  mkdirSync(toolDir, { recursive: true });
  const restore = join(toolDir, "pg_restore");
  writeFileSync(restore, "#!/usr/bin/env bash\nif [[ \"$1\" == \"--version\" ]]; then echo 'pg_restore (PostgreSQL) 16.14'; else echo '1; 1 1 TABLE public demo postgres'; fi\n");
  chmodSync(restore, 0o755);
  const archive = join(root, "format-1.15.dump");
  writeFileSync(archive, "PGDMP test archive format 1.15");
  writeFileSync(`${archive}.sha256`, `${sha256File(archive)}  format-1.15.dump\n`);
  const evidence = verifyBackupArtifact({
    backupPath: archive,
    checksumPath: `${archive}.sha256`,
    requireOutsideRepository: false,
    postgresToolSelection: {
      mode: "host",
      container: null,
      serverMajor: 16,
      clientMajor: 16,
      clientVersion: "pg_restore (PostgreSQL) 16.14",
      dumpBin: join(toolDir, "pg_dump"),
      restoreBin: restore,
      dumpVersion: "pg_dump (PostgreSQL) 16.14",
      restoreVersion: "pg_restore (PostgreSQL) 16.14",
      explicit: true,
    },
  });
  assert.equal(evidence.archiveCatalogEntries, 1);
}

console.log("db lifecycle tests passed");
