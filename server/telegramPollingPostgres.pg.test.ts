import assert from "node:assert/strict";
import { TelegramUpdateReceiver } from "./telegram/updateReceiver";
import { InMemoryTelegramRepository } from "./telegram/repository";
import { TelegramUpdateCursor } from "./telegram/updateCursor";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log("telegram polling PostgreSQL leadership tests skipped: TEST_DATABASE_URL is not set");
} else {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    let firstCalls = 0;
    let secondCalls = 0;
    const first = receiver(() => {
      firstCalls += 1;
    });
    const second = receiver(() => {
      secondCalls += 1;
    });
    first.start();
    second.start();
    await waitFor(() => first.health().ownershipState === "owned" || second.health().ownershipState === "owned");
    await waitFor(() => [first.health().ownershipState, second.health().ownershipState].includes("standby"));
    assert.equal(first.health().leadershipKind, "postgres");
    assert.equal(second.health().leadershipKind, "postgres");
    assert.equal(first.health().ownershipState === "owned" && second.health().ownershipState === "owned", false);
    const leader = first.health().ownershipState === "owned" ? first : second;
    const standby = leader === first ? second : first;
    const standbyCallsBefore = standby === first ? firstCalls : secondCalls;
    assert.equal(standbyCallsBefore, 0, "standby receiver must not poll");
    await leader.stop();

    const successor = receiver(() => {
      secondCalls += 1;
    });
    successor.start();
    await waitFor(() => successor.health().ownershipState === "owned");
    assert.equal(successor.health().leadershipKind, "postgres");
    await successor.stop();
    await standby.stop();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
  console.log("telegram polling PostgreSQL leadership tests passed");
}

function receiver(onPoll: () => void) {
  return new TelegramUpdateReceiver(config(), new TelegramUpdateCursor(new InMemoryTelegramRepository()), { handle: async () => undefined }, (async () => {
    onPoll();
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as typeof fetch);
}

function config() {
  return {
    botToken: "postgres-leadership-test-token",
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

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("condition not reached");
}
