import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { PgStorage } from "./storage";
import { createDatabase } from "./db";

if (!process.env.DATABASE_URL) {
  console.log("pgStorage integration skipped: DATABASE_URL is not set");
  process.exit(0);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(readFileSync("migrations/0001_marketpilot_core.sql", "utf-8"));
await client.end();

const storage = new PgStorage(createDatabase(process.env.DATABASE_URL));
const overview = await storage.getMarketPilotOverview();

assert.equal(overview.user.liveTradingEnabled, false);
assert.ok(overview.modules.length >= 1);
assert.ok(overview.tradeTickets.some((ticket) => ticket.status === "proposed"));

const savedReport = await storage.saveResearchReport({
  ...overview.researchReports[0],
  id: `report-pgstorage-${Date.now()}`,
  title: "PostgreSQL Storage Research Persistence",
});
const overviewAfterReport = await storage.getMarketPilotOverview();
assert.equal(overviewAfterReport.researchReports[0].id, savedReport.id);

const ticket = await storage.createTradeTicket({
  asset: "SGOV",
  direction: "buy",
  quantity: 2,
  entryPrice: 100.4,
  stopLoss: 99.9,
  timeHorizon: "4 weeks",
  rationale:
    "Integration-test paper proposal with limited risk to prove PostgreSQL storage can persist tickets.",
  supportingEvidence: ["Paper-only workflow", "Defined stop"],
  alternativeChoices: ["Hold cash"],
  exitCriteria: "Exit when risk rule is breached.",
  invalidationCondition: "Reject if the risk engine fails approval.",
});

assert.equal(ticket.riskCheck.decision, "approve");
assert.equal(ticket.status, "proposed");

const preview = await storage.createOrderPreview(ticket.id);
assert.equal(preview.tradeTicketId, ticket.id);
assert.equal(preview.liveExecutionBlocked, true);

const filled = await storage.fillPaperTrade(ticket.id, {
  complianceAcknowledged: true,
  userConfirmation: "I acknowledge this paper fill.",
  previewId: preview.id,
});
assert.equal(filled.ticket.status, "paper_filled");
assert.equal(filled.journalEntry.linkedTicketId, ticket.id);

console.log("pgStorage integration tests passed");
