import assert from "node:assert/strict";
import { createSeedOverview } from "./storage";
import { DemoGraphSupervisorRuntime, ExistingSupervisorRuntimeAdapter } from "./supervisorRuntimeService";

const overview = createSeedOverview();
const runtime = new ExistingSupervisorRuntimeAdapter();
const state = runtime.snapshot(overview);

assert.equal(state.executionBlocked, true);
assert.equal(state.humanApproval.required, true);
assert.equal(state.humanApproval.granted, false);
assert.ok(state.nodes.some((node) => node.id === "verification"));
assert.ok(state.transitions.some((transition) => transition.from === "idea" && transition.to === "verification"));

const approvalState = runtime.requestApproval(state);
assert.equal(approvalState.currentNode, "human_approval");
assert.equal(approvalState.humanApproval.granted, false);

const demoState = new DemoGraphSupervisorRuntime().snapshot(overview);
assert.equal(demoState.runId, `supervisor-${overview.user.id}`);

console.log("supervisorRuntimeService smoke tests passed");
