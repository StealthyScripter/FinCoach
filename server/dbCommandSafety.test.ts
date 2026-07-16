import assert from "node:assert/strict";
import { spawnSync } from "child_process";

const baseEnv = { ...process.env };

const pushDefault = spawnSync("npm", ["run", "db:push"], { encoding: "utf8", env: baseEnv });
assert.notEqual(pushDefault.status, 0);
assert.match(pushDefault.stderr, /disabled by default/);
assert.doesNotMatch(pushDefault.stderr, /secret/);

const pushProduction = spawnSync("npm", ["run", "db:push", "--", "--i-understand-this-destroys-disposable-local-state"], {
  encoding: "utf8",
  env: {
    ...baseEnv,
    FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH: "true",
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:secret@localhost:5432/fincoach_test",
  },
});
assert.notEqual(pushProduction.status, 0);
assert.match(pushProduction.stderr, /production/);
assert.doesNotMatch(pushProduction.stderr, /secret/);

const restoreMissingBackup = spawnSync("npm", ["run", "db:restore:verify"], {
  encoding: "utf8",
  env: { ...baseEnv, DATABASE_URL: "postgres://user:secret@localhost:5432/fincoach_test" },
});
assert.notEqual(restoreMissingBackup.status, 0);
assert.match(`${restoreMissingBackup.stderr}\n${restoreMissingBackup.stdout}`, /--backup is required/);
assert.doesNotMatch(`${restoreMissingBackup.stderr}\n${restoreMissingBackup.stdout}`, /secret/);

const malformedIncident = spawnSync("npm", ["run", "db:incident:assess"], {
  encoding: "utf8",
  env: { ...baseEnv, DATABASE_URL: "not a url with secret" },
});
assert.notEqual(malformedIncident.status, 0);
assert.match(malformedIncident.stdout, /unable_to_assess/);
assert.doesNotMatch(malformedIncident.stdout, /secret/);

console.log("db command safety tests passed");
