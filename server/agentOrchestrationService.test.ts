import assert from "node:assert/strict";
import { agentOutputSchema } from "@shared/schema";
import { AgentOrchestrationService } from "./agentOrchestrationService";
import { createSeedOverview } from "./storage";

const service = new AgentOrchestrationService();
const outputs = service.generateOutputs(createSeedOverview(), new Date("2026-06-15T12:00:00.000Z"));

assert.equal(outputs.length, 10);
for (const output of outputs) {
  assert.doesNotThrow(() => agentOutputSchema.parse(output));
  assert.ok(output.observations.length > 0);
  assert.ok(output.citations.length > 0);
}

const agents = outputs.map((output) => output.agent);
assert.deepEqual(agents, [
  "macro",
  "equity",
  "etf",
  "options",
  "forex",
  "commodities",
  "bonds",
  "portfolio",
  "risk",
  "verification",
]);

const riskOfficer = outputs.find((output) => output.agent === "risk");
assert.equal(riskOfficer?.status, "action_required");
assert.match(riskOfficer?.summary ?? "", /Risk Officer veto/);

const optionsAgent = outputs.find((output) => output.agent === "options");
assert.equal(optionsAgent?.status, "blocked");
assert.match(optionsAgent?.observations.join(" ") ?? "", /options proficiency/i);

console.log("agentOrchestrationService smoke tests passed");
