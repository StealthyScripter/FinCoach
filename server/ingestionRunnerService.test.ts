import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { IngestionRunnerService } from "./ingestionRunnerService";
import { storage } from "./storage";

eventLogService.clearForTest();
const service = new IngestionRunnerService();
const dryRun = await service.run({ providers: ["market", "fred"], assets: ["SPY", "QQQ"], dryRun: true });

assert.equal(dryRun.status, "dry_run");
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.providerReports.length, 2);
assert.equal(eventLogService.countByType("provider.ingestion_run"), 1);
assert.ok((await storage.getIngestionRuns()).some((record) => record.id === dryRun.id));

const run = await service.run({ providers: ["calendar"], dryRun: false });
assert.equal(run.status, "success");
assert.equal(run.providerReports[0].provider, "calendar");
assert.ok((await storage.getIngestionRuns()).some((record) => record.id === run.id));

console.log("ingestionRunnerService smoke tests passed");
