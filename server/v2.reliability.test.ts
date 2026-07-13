import assert from "node:assert/strict";
import { ReliabilityV2EventTypes, ReliabilityV2Service } from "./v2/reliability";

const correlationId = "00000000-0000-4000-8000-000000000025";
const service = new ReliabilityV2Service({
  maxPayloadBytes: 128,
  workerQuota: 1,
  leaseTtlMs: 20,
  retryBudget: 2,
  allowedEndpoints: ["https://api-fxpractice.oanda.com"],
});

const lease = service.acquireDurableLease("scheduler", "worker-a", correlationId);
assert.equal(lease.events[0].eventType, ReliabilityV2EventTypes.DurableLeaseAcquired);
assert.equal(service.acquireDurableLease("scheduler", "worker-b", correlationId).events[0].payload.reason, "lease_contention");
await new Promise(resolve => setTimeout(resolve, 25));
assert.equal(service.recoverStaleLeases("worker-b", correlationId).events[0].eventType, ReliabilityV2EventTypes.StaleLeaseRecovered);

assert.equal(service.validatePayload({ ok: true }, correlationId).accepted, true);
const tooLarge = service.validatePayload({ text: "x".repeat(200) }, correlationId);
assert.equal(tooLarge.accepted, false);
assert.equal(tooLarge.events[0].payload.reason, "payload_too_large");

const redacted = service.redactSecrets("token=abc OANDA_API_TOKEN=secret TELEGRAM_BOT_TOKEN=secret2");
assert.equal(redacted.includes("secret"), false);
assert.match(redacted, /\[REDACTED\]/);

const practice = service.validateEndpoint("https://api-fxpractice.oanda.com/v3/accounts", correlationId);
assert.equal(practice.accepted, true);
const live = service.validateEndpoint("https://api-fxtrade.oanda.com/v3/accounts", correlationId);
assert.equal(live.accepted, false);
assert.equal(live.events[0].payload.reason, "live_endpoint_blocked");

service.recordProviderFailure("oanda-practice", "timeout", correlationId);
service.recordProviderFailure("oanda-practice", "timeout", correlationId);
const opened = service.recordProviderFailure("oanda-practice", "timeout", correlationId);
assert.equal(opened.events[0].eventType, ReliabilityV2EventTypes.ProviderCircuitBreakerOpened);
assert.equal(service.providerStatus("oanda-practice"), "open");
assert.equal(service.recordProviderSuccess("oanda-practice", correlationId).events[0].eventType, ReliabilityV2EventTypes.ProviderCircuitBreakerClosed);

const retryOne = service.classifyFailure("event-1", Object.assign(new Error("db down"), { retryable: true }), 1, correlationId);
assert.equal(retryOne.events[0].eventType, ReliabilityV2EventTypes.RetryBudgetRecorded);
const retryExhausted = service.classifyFailure("event-1", Object.assign(new Error("db down"), { retryable: true }), 3, correlationId);
assert.equal(retryExhausted.events[0].eventType, ReliabilityV2EventTypes.RetryBudgetExhausted);

const audit = service.appendAudit({ subjectId: "cycle-1", action: "checkpoint", payloadHash: "hash-1", correlationId });
const tampered = service.verifyAuditChain([{ ...audit.record!, payloadHash: "changed" }]);
assert.equal(tampered.valid, false);
assert.equal(tampered.events[0].eventType, ReliabilityV2EventTypes.AuditChainTamperDetected);

service.createDeadLetter("event-dead", "poison_event", correlationId);
assert.equal(service.replayDeadLetter("event-dead", correlationId).events[0].eventType, ReliabilityV2EventTypes.DeadLetterReplayRequested);
assert.equal(service.health().liveExecutionBlocked, true);
assert.equal("placeOrder" in service || "submitOrder" in service || "logCredential" in service, false);

console.log("v2 phase 25 reliability tests passed");
