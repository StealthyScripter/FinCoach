import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { assertDbPushAllowed, assertDisposableLocalDatabase, readChecksumFile, sha256File } from "../scripts/db/dbLifecycle";

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

console.log("db lifecycle tests passed");
