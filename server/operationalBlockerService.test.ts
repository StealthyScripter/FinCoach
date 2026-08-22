import assert from "node:assert/strict";
import { OperationalBlockerService } from "./operationalBlockerService";
import { classifyOperationalAlert, operatorIncidentKey, shouldSendOperatorTelegramAlert } from "./operationalAlertPolicy";

const sent: string[] = [];
const notifications = {
  sendOperations: async (_kind: string, text: string) => {
    sent.push(text);
    return { sent: true as const, result: { delivery: { id: `delivery-${sent.length}` } } };
  },
};

const env = {
  TELEGRAM_NOTIFICATIONS_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: "test-token-never-print",
  TELEGRAM_CHAT_ID: "123456",
  FINCOACH_OPERATIONAL_ALERT_REMINDER_MINUTES: "60",
} as NodeJS.ProcessEnv;

{
  const service = new OperationalBlockerService(env, notifications);
  const first = await service.record({
    kind: "configuration",
    code: "broker_not_configured",
    title: "Broker endpoint is not configured",
    whatBlocked: "OANDA PRACTICE order submission",
    reason: "OANDA_BASE_URL is unset",
    currentValue: "",
    limitValue: "https://api-fxpractice.oanda.com/v3",
    configKey: "OANDA_BASE_URL",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: true,
    expected: false,
    action: "Configure OANDA PRACTICE endpoint.",
    now: new Date("2026-08-14T21:00:00.000Z"),
  });
  const second = await service.record({
    kind: "configuration",
    code: "broker_not_configured",
    title: "Broker endpoint is not configured",
    whatBlocked: "OANDA PRACTICE order submission",
    reason: "OANDA_BASE_URL is unset",
    currentValue: "",
    limitValue: "https://api-fxpractice.oanda.com/v3",
    configKey: "OANDA_BASE_URL",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: false,
    action: "Configure OANDA PRACTICE endpoint.",
    now: new Date("2026-08-14T21:10:00.000Z"),
  });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal((await service.list()).length, 1);
  assert.equal(sent.length, 1, "identical alert should not resend inside reminder interval");

  await service.record({
    kind: "configuration",
    code: "broker_not_configured",
    title: "Broker endpoint is not configured",
    whatBlocked: "OANDA PRACTICE order submission",
    reason: "OANDA_BASE_URL is unset",
    currentValue: "",
    limitValue: "https://api-fxpractice.oanda.com/v3",
    configKey: "OANDA_BASE_URL",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: false,
    action: "Configure OANDA PRACTICE endpoint.",
    now: new Date("2026-08-14T22:05:00.000Z"),
  });
  assert.equal(sent.length, 2, "alert should resend after reminder interval");
}

{
  assert.equal(classifyOperationalAlert({ code: "rr_below_minimum", expected: true }), "EXPECTED_POLICY_REJECTION");
  assert.equal(shouldSendOperatorTelegramAlert({ code: "spread_above_limit", expected: true }), false);
  assert.equal(shouldSendOperatorTelegramAlert({ code: "broker_authentication_failed", expected: false }), true);
  assert.equal(shouldSendOperatorTelegramAlert({ code: "reconciliation_stale", expected: false }), true);
  assert.equal(shouldSendOperatorTelegramAlert({ code: "market_data_provider_fallback_active", kind: "fallback", expected: false }), true);
  assert.equal(
    operatorIncidentKey({ code: "broker_authentication_failed", broker: "oanda_practice", account: "practice", environment: "practice" }),
    operatorIncidentKey({ code: "BROKER_AUTHENTICATION_FAILED", broker: "oanda_practice", account: "practice", environment: "practice" }),
  );
}

{
  const service = new OperationalBlockerService(env, notifications);
  await service.reconcileActive([
    {
      kind: "fallback",
      code: "provider_credentials_missing",
      title: "Provider fallback active",
      whatBlocked: "provider-backed research output",
      reason: "OANDA_API_TOKEN is unset",
      currentValue: "OANDA_API_TOKEN=super-secret-value-that-must-not-appear",
      limitValue: "provider-backed candles",
      configKey: "OANDA_API_TOKEN",
      configValueState: "EMPTY",
      expected: false,
      action: "Configure OANDA credentials.",
      now: new Date("2026-08-14T21:00:00.000Z"),
    },
  ], new Date("2026-08-14T21:00:00.000Z"));
  await service.reconcileActive([], new Date("2026-08-14T21:30:00.000Z"));
  const snapshot = await service.snapshot(new Date("2026-08-14T21:31:00.000Z"));
  assert.equal(snapshot.active.length, 0);
  assert.equal(snapshot.resolvedBlockers.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("super-secret-value"));
  assert.match(sent.at(-1) ?? "", /operational recovery/);
}

{
  const noTelegram = new OperationalBlockerService({ TELEGRAM_NOTIFICATIONS_ENABLED: "false" } as NodeJS.ProcessEnv, notifications);
  const before = sent.length;
  await noTelegram.record({
    kind: "configuration",
    code: "database_url_missing",
    title: "Runtime blocked: missing database",
    whatBlocked: "runtime initialization",
    reason: "DATABASE_URL is required",
    currentValue: "",
    limitValue: "SET",
    configKey: "DATABASE_URL",
    configValueState: "EMPTY",
    expected: false,
    action: "Configure DATABASE_URL.",
  });
  assert.equal(sent.length, before, "Telegram-disabled environment must not send");
}

{
  const service = new OperationalBlockerService({ TELEGRAM_NOTIFICATIONS_ENABLED: "false" } as NodeJS.ProcessEnv, notifications);
  const first = await service.record({
    kind: "lifecycle",
    code: "forward_test_candidate_rejected",
    title: "Forward-test candidate rejected",
    whatBlocked: "forward-test candidate",
    reason: "court verdict not eligible",
    currentValue: "reject",
    limitValue: "approve_for_forward_test",
    scope: { cycleId: "cycle-1", strategyId: "strategy-1", component: "forward-testing" },
    expected: true,
    action: "Let evidence mature.",
    now: new Date("2026-08-14T21:00:00.000Z"),
  });
  const second = await service.record({
    kind: "lifecycle",
    code: "forward_test_candidate_rejected",
    title: "Forward-test candidate rejected",
    whatBlocked: "forward-test candidate",
    reason: "court verdict not eligible",
    currentValue: "reject",
    limitValue: "approve_for_forward_test",
    scope: { cycleId: "cycle-2", strategyId: "strategy-1", component: "forward-testing" },
    expected: true,
    action: "Let evidence mature.",
    now: new Date("2026-08-14T22:00:00.000Z"),
  });
  assert.equal(first.fingerprint, second.fingerprint, "known repeated eligibility blockers aggregate across cycles");
  const records = await service.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].occurrenceCount, 2);
  assert.equal(records[0].firstSeenAt, "2026-08-14T21:00:00.000Z");
  assert.equal(records[0].lastSeenAt, "2026-08-14T22:00:00.000Z");
}

console.log("operational blocker service tests passed");
