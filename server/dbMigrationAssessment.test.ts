import assert from "node:assert/strict";
import { parseMigrationExpectation } from "../scripts/db/migrationAssessment";

const parsed = parseMigrationExpectation(`
  CREATE TABLE IF NOT EXISTS sample_accounts (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email, created_at)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_accounts_email ON sample_accounts (email);
  CREATE INDEX IF NOT EXISTS idx_sample_accounts_created ON sample_accounts (created_at DESC);
`);

assert.equal(parsed.tables.length, 1);
assert.equal(parsed.tables[0].name, "sample_accounts");
assert.deepEqual(parsed.tables[0].primaryKeyColumns, ["id"]);
assert.ok(parsed.tables[0].uniqueColumnSets.some((set) => set.join(",") === "email"));
assert.ok(parsed.tables[0].uniqueColumnSets.some((set) => set.join(",") === "created_at,email"));
assert.equal(parsed.tables[0].columns.find((column) => column.name === "payload")?.type, "jsonb");
assert.equal(parsed.tables[0].columns.find((column) => column.name === "created_at")?.hasDefault, true);
assert.deepEqual(parsed.indexes.map((index) => `${index.name}:${index.unique}`), ["idx_sample_accounts_email:true", "idx_sample_accounts_created:false"]);

console.log("db migration assessment tests passed");
