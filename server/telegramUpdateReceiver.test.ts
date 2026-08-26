import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TelegramUpdateReceiver, type TelegramPollingCoordinator, type TelegramPollingLeadership } from "./telegram/updateReceiver";
import { InMemoryTelegramRepository } from "./telegram/repository";
import { TelegramUpdateCursor } from "./telegram/updateCursor";

const root = mkdtempSync(join(tmpdir(), "fincoach-telegram-receiver-"));
const lockPath = join(root, "poll.lock");
const originalLockPath = process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH;
process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH = lockPath;

try {
  {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const receiver = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), okFetch());
    receiver.start();
    await waitFor(() => receiver.health().ownershipState === "blocked");
    const health = receiver.health();
    assert.equal(health.running, false);
    assert.equal(health.ownershipState, "blocked");
    assert.equal(health.lastPollError, "telegram_poll_lock_held");
    await receiver.stop();
    rmSync(lockPath, { force: true });
  }

  {
    const receiver = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), conflictFetch());
    receiver.start();
    await waitFor(() => receiver.health().ownershipState === "conflict");
    const health = receiver.health();
    assert.equal(health.running, false);
    assert.equal(health.stopped, true);
    assert.equal(health.lastPollError, "Telegram getUpdates failed with HTTP 409; another bot update consumer is active");
    assert.equal(existsSync(lockPath), false);
    await receiver.stop();
  }
} finally {
  if (originalLockPath === undefined) delete process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH;
  else process.env.FINCOACH_TELEGRAM_POLL_LOCK_PATH = originalLockPath;
  rmSync(root, { recursive: true, force: true });
}

function config() {
  return {
    botToken: "test-token",
    allowedUserId: "operator",
    chatId: "chat",
    signalChatId: null,
    webhookSecret: null,
    webhookUrl: null,
    notificationsEnabled: true,
    signalsEnabled: false,
    transport: "long_polling" as const,
    commandPollingEnabled: true,
    inboundPollingEnabled: true,
    longPollingEnabled: true,
    webhookEnabled: false,
    dailySummaryHourUtc: 22,
    weeklySummaryDay: 0,
    weeklySummaryHourUtc: 22,
    marketSessionAlerts: false,
    minSignalConfidence: 75,
    minSignalEvidenceScore: 0.75,
    signalCooldownMinutes: 60,
    signalSigningSecret: null,
  };
}

function transport() {
  return { handle: async () => undefined };
}

function okFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function conflictFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify({ ok: false, description: "Conflict" }), { status: 409, headers: { "content-type": "application/json" } })) as typeof fetch;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("condition not reached");
}

class FakeDistributedCoordinator implements TelegramPollingCoordinator {
  private held = false;

  async tryAcquire(_botToken: string) {
    if (this.held) return { acquired: false as const, reason: "telegram_polling_leader_exists", kind: "postgres" as const };
    this.held = true;
    const leadership: TelegramPollingLeadership = {
      kind: "postgres",
      release: async () => {
        this.held = false;
      },
    };
    return { acquired: true as const, leadership };
  }
}

{
  const receiver = new TelegramUpdateReceiver({ ...config(), inboundPollingEnabled: false }, new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), okFetch());
  receiver.start();
  const health = receiver.health();
  assert.equal(health.running, false);
  assert.equal(health.ownershipState, "blocked");
  assert.equal(health.lastPollError, "fincoach_telegram_inbound_polling_disabled");
}

{
  const coordinator = new FakeDistributedCoordinator();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), (async () => {
    firstCalls += 1;
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as typeof fetch, coordinator);
  const second = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), (async () => {
    secondCalls += 1;
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as typeof fetch, coordinator);
  first.start();
  second.start();
  await waitFor(() => first.health().ownershipState === "owned");
  await waitFor(() => second.health().ownershipState === "standby");
  assert.equal(first.health().leadershipKind, "postgres");
  assert.equal(secondCalls, 0, "standby receiver must not poll");
  await first.stop();
  second.stop();

  const successor = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), (async () => {
    secondCalls += 1;
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as typeof fetch, coordinator);
  successor.start();
  await waitFor(() => successor.health().ownershipState === "owned");
  await waitFor(() => secondCalls > 0);
  assert.ok(firstCalls > 0, "first leader should poll");
  await successor.stop();
}

for (const [name, override] of [
  ["command polling unset", { commandPollingEnabled: false }],
  ["command polling false", { commandPollingEnabled: false }],
  ["inbound false", { commandPollingEnabled: true, inboundPollingEnabled: false }],
  ["long polling false", { commandPollingEnabled: true, inboundPollingEnabled: true, longPollingEnabled: false }],
  ["transport not long polling", { commandPollingEnabled: true, inboundPollingEnabled: true, longPollingEnabled: true, transport: "webhook" as const }],
] as const) {
  let calls = 0;
  const receiver = new TelegramUpdateReceiver({ ...config(), ...override }, new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as typeof fetch);
  receiver.start();
  assert.equal(receiver.health().running, false, name);
  assert.equal(calls, 0, `${name} must not call getUpdates`);
}

{
  let calls = 0;
  const receiver = new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), transport(), (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false, parameters: { retry_after: 1 } }), { status: 429, headers: { "retry-after": "1" } });
  }) as typeof fetch);
  receiver.start();
  await waitFor(() => calls > 0);
  assert.equal(receiver.health().running, true);
  await receiver.stop();
}

console.log("telegram update receiver ownership tests passed");
