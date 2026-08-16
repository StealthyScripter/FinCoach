import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgTelegramRepository } from "./telegram/repository";
import { WeeklyMarketNotificationService } from "./telegram/weeklyMarketNotificationService";
import { weeklyResearchWindowState, weeklyTransitionId } from "./v2/runtime/weeklyResearchWindow";

if (!process.env.DATABASE_URL) {
  console.log("telegram weekly session notification PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const suffix = `weekly-pg-${Date.now()}-${randomUUID().slice(0, 8)}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repoA = new PgTelegramRepository(process.env.DATABASE_URL);
const repoB = new PgTelegramRepository(process.env.DATABASE_URL);
const sent: Array<Record<string, unknown>> = [];
const notifications = {
  sendOperations: async (kind: string, text: string, metadata: Record<string, unknown>) => {
    sent.push({ kind, text, metadata });
    return { sent: true as const, result: { delivery: { id: `delivery-${sent.length}-${suffix}` } } };
  },
};

const config = { enabled: true, timezone: "UTC", openDay: 0, openTime: "21:00", closeDay: 5, closeTime: "21:00", startLeadMinutes: 5 };
const fixtureWeekOffset = Date.now() % 500;
const openBoundary = new Date(Date.UTC(2099, 7, 9 + fixtureWeekOffset * 7, 21, 0, 0)).toISOString();
const closeBoundary = new Date(Date.UTC(2099, 7, 14 + fixtureWeekOffset * 7, 21, 0, 0)).toISOString();
const openKey = weeklyTransitionId("open", openBoundary);
const closeKey = weeklyTransitionId("close", closeBoundary);

try {
  const serviceA = new WeeklyMarketNotificationService(repoA, notifications as never);
  const serviceB = new WeeklyMarketNotificationService(repoB, notifications as never);
  const openWindow = weeklyResearchWindowState(config, new Date(openBoundary));
  const closeWindow = weeklyResearchWindowState(config, new Date(closeBoundary));

  const firstOpen = await serviceA.sendOpen({ boundaryAt: openBoundary, window: openWindow });
  const duplicateOpenAfterRestart = await serviceB.sendOpen({ boundaryAt: openBoundary, window: openWindow });
  assert.equal(firstOpen.status, "delivered");
  assert.equal(duplicateOpenAfterRestart.skipped, true);
  assert.equal(sent.filter(item => (item.metadata as Record<string, unknown>).transitionType === "open").length, 1);

  const persistedOpen = await pool.query("SELECT idempotency_key, status FROM telegram_weekly_session_notifications WHERE idempotency_key = $1", [openKey]);
  assert.equal(persistedOpen.rows[0]?.idempotency_key, openKey);
  assert.equal(persistedOpen.rows[0]?.status, "delivered");

  const manualKey = `${weeklyTransitionId("open", `2099-08-10T21:00:00.000Z`)}:${suffix}`;
  const claimed = await repoA.claimWeeklySessionNotification(notificationRecord(manualKey, "open", "2099-08-10T21:00:00.000Z"));
  const duplicateClaimAfterRestart = await repoB.claimWeeklySessionNotification(notificationRecord(manualKey, "open", "2099-08-10T21:00:00.000Z"));
  assert.equal(claimed.claimed, true);
  assert.equal(duplicateClaimAfterRestart.claimed, false);
  await repoA.completeWeeklySessionNotification(manualKey, { status: "delivered", deliveryId: `manual-delivery-${suffix}`, metadata: { sent: true } });
  const duplicateDeliveredClaim = await repoB.claimWeeklySessionNotification(notificationRecord(manualKey, "open", "2099-08-10T21:00:00.000Z"));
  assert.equal(duplicateDeliveredClaim.claimed, false);

  const firstClose = await serviceA.sendClose({ boundaryAt: closeBoundary, window: closeWindow });
  const duplicateCloseAfterRestart = await serviceB.sendClose({ boundaryAt: closeBoundary, window: closeWindow });
  assert.equal(firstClose.status, "delivered");
  assert.equal(duplicateCloseAfterRestart.skipped, true);
  assert.equal(sent.filter(item => (item.metadata as Record<string, unknown>).transitionType === "close").length, 1);

  const rows = await pool.query("SELECT idempotency_key, status FROM telegram_weekly_session_notifications WHERE idempotency_key = ANY($1) ORDER BY idempotency_key", [[openKey, closeKey, manualKey]]);
  assert.equal(rows.rowCount, 3);
  assert.deepEqual(rows.rows.map(row => row.status), ["delivered", "delivered", "delivered"]);
  console.log("telegram weekly session notification PostgreSQL tests passed");
} finally {
  await pool.query("DELETE FROM telegram_weekly_session_notifications WHERE idempotency_key IN ($1, $2, $3)", [openKey, closeKey, `${weeklyTransitionId("open", `2099-08-10T21:00:00.000Z`)}:${suffix}`]).catch(() => undefined);
  await (repoA as unknown as { pool?: Pool | null }).pool?.end().catch(() => undefined);
  await (repoB as unknown as { pool?: Pool | null }).pool?.end().catch(() => undefined);
  await pool.end();
}

function notificationRecord(idempotencyKey: string, transitionType: "open" | "close", boundaryAt: string) {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    transitionType,
    boundaryAt,
    status: "claimed" as const,
    deliveryId: null,
    attemptCount: 0,
    lastError: null,
    metadata: { test: suffix },
    createdAt: now,
    updatedAt: now,
  };
}
