import assert from "node:assert/strict";
import { OperationalBlockerService } from "./operationalBlockerService";

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
    kind: "limit",
    code: "max_observations_per_cycle_reached",
    title: "Research blocked: maximum observations reached",
    whatBlocked: "remaining observation candidates",
    reason: "cycle_budget",
    currentValue: 400,
    limitValue: 400,
    configKey: "FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: true,
    action: "Increase only if capacity supports it.",
    now: new Date("2026-08-14T21:00:00.000Z"),
  });
  const second = await service.record({
    kind: "limit",
    code: "max_observations_per_cycle_reached",
    title: "Research blocked: maximum observations reached",
    whatBlocked: "remaining observation candidates",
    reason: "cycle_budget",
    currentValue: 400,
    limitValue: 400,
    configKey: "FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: true,
    action: "Increase only if capacity supports it.",
    now: new Date("2026-08-14T21:10:00.000Z"),
  });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal((await service.list()).length, 1);
  assert.equal(sent.length, 1, "identical alert should not resend inside reminder interval");

  await service.record({
    kind: "limit",
    code: "max_observations_per_cycle_reached",
    title: "Research blocked: maximum observations reached",
    whatBlocked: "remaining observation candidates",
    reason: "cycle_budget",
    currentValue: 400,
    limitValue: 400,
    configKey: "FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE",
    configValueState: "SET",
    scope: { cycleId: "cycle-1", symbol: "EUR_USD" },
    expected: true,
    action: "Increase only if capacity supports it.",
    now: new Date("2026-08-14T22:05:00.000Z"),
  });
  assert.equal(sent.length, 2, "alert should resend after reminder interval");
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
