import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";

const script = "scripts/v2-replay/run-gated-cloud-release.sh";

const help = execFileSync("bash", [script, "--help"], { encoding: "utf8" });
assert.match(help, /five-year-single/);
assert.match(help, /dataset-build/);
assert.match(help, /ten-year-compare/);

const missingConfig = spawnSync("bash", [script, "five-year-single", "--dry-run"], { encoding: "utf8" });
assert.notEqual(missingConfig.status, 0);
assert.match(missingConfig.stderr, /--config is required/);

const unsafe = spawnSync("bash", [script, "verify", "--output", "artifacts/v2-replay/gated-test", "--dry-run"], { encoding: "utf8", env: { ...process.env, BROKER_EXECUTION_ENABLED: "true" } });
assert.notEqual(unsafe.status, 0);
assert.match(unsafe.stderr, /broker execution enabled/);

const verify = execFileSync("bash", [script, "verify", "--output", "artifacts/v2-replay/gated-test", "--dry-run"], { encoding: "utf8" });
assert.match(verify, /OUTPUT_DIR=artifacts\/v2-replay\/gated-test/);
assert.match(verify, /run-cloud-verify\.sh/);

const datasetBuild = execFileSync("bash", [script, "dataset-build", "--config", "config/replay-campaigns/five-year-single.example.env", "--dry-run"], { encoding: "utf8" });
assert.match(datasetBuild, /build-oanda-dataset\.sh/);
assert.match(datasetBuild, /five-year-single\.example\.env/);

const datasetValidate = execFileSync("bash", [script, "dataset-validate", "--dataset-manifest", "/data/manifest.json", "--dry-run"], { encoding: "utf8" });
assert.match(datasetValidate, /v2:dataset:validate/);

const preflight = execFileSync("bash", [script, "preflight", "--expected-commit", "abc1234", "--dataset-manifest", "/data/manifest.json", "--output", "/tmp/out path", "--min-free-disk-gb", "1", "--min-memory-gb", "1", "--dry-run"], { encoding: "utf8" });
assert.match(preflight, /cloud-preflight\.sh/);
assert.ok(preflight.includes("/tmp/out\\ path"));

const compare = execFileSync("bash", [script, "five-year-compare", "--left", "/tmp/a summary.json", "--right", "/tmp/b summary.json", "--dry-run"], { encoding: "utf8" });
assert.match(compare, /compare-campaign-runs\.sh/);
assert.ok(compare.includes("/tmp/a\\ summary.json"));

const finalize = execFileSync("bash", [script, "finalize", "--output", "artifacts/v2-replay/gated-test", "--dry-run"], { encoding: "utf8" });
assert.match(finalize, /v2:replay:validate/);
assert.match(finalize, /v2:replay:report/);

console.log("v2 gated cloud release script tests passed");
