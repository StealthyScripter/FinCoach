import assert from "node:assert/strict";
import { providerRegistrySnapshotSchema } from "@shared/schema";
import { providerRegistryService } from "./providerRegistryService";

const snapshot = providerRegistryService.getSnapshot(new Date("2026-01-15T14:00:00.000Z"));

providerRegistrySnapshotSchema.parse(snapshot);
assert.ok(snapshot.providers.some((provider) => provider.kind === "market_data"));
assert.ok(snapshot.providers.some((provider) => provider.kind === "economic_data"));
assert.ok(snapshot.providers.some((provider) => provider.kind === "news"));
assert.ok(snapshot.providers.some((provider) => provider.kind === "filings"));
assert.ok(snapshot.providers.some((provider) => provider.kind === "options_data"));
assert.ok(snapshot.providers.some((provider) => provider.kind === "broker_data"));
assert.ok(snapshot.providers.every((provider) => provider.providerMode === "demo"));

console.log("providerRegistryService smoke tests passed");
