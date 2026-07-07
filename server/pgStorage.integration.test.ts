import assert from "node:assert/strict";
import { Client } from "pg";
import { PgStorage } from "./storage";
import { createDatabase } from "./db";
import { PgTransactionalReliabilityRepository } from "./execution/transactionalReliabilityRepository";
import { PgGovernanceRepository } from "./execution/governanceRepository";
import { PgEventLogStore } from "./eventLogStoreService";
import { PgVectorStore } from "./vectorStoreService";
import { bootstrapTestDatabase } from "./testDatabase";
import { DemoRunRecordStore } from "./demoRunRecordStore";

if (!process.env.DATABASE_URL) {
  console.log("pgStorage integration skipped: DATABASE_URL is not set");
  process.exit(0);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await bootstrapTestDatabase();

const storage = new PgStorage(createDatabase(process.env.DATABASE_URL));
const cleanupClient = new Client({ connectionString: process.env.DATABASE_URL });
let testReportId = "";
let testVerificationId = "";
let demoRunId = "";
let stoppedDemoRunId = "";

try {
  const overview = await storage.getMarketPilotOverview();

  assert.equal(overview.user.liveTradingEnabled, false);
  assert.ok(overview.modules.length >= 1);
  assert.ok(overview.tradeTickets.some((ticket) => ticket.status === "proposed"));

  await client.connect();
  const expectedTables = [
    "strategy_evidence_records",
    "marketpilot_events",
    "execution_audit_entries",
    "demo_run_records",
  ];
  for (const tableName of expectedTables) {
    const result = await client.query("SELECT to_regclass($1) AS table_name", [tableName]);
    assert.equal(result.rows[0]?.table_name, tableName, `${tableName} should exist`);
  }
  await client.end();

  testReportId = `report-pgstorage-${Date.now()}`;
  testVerificationId = `verify-pgstorage-${Date.now()}`;
  const savedReport = await storage.saveResearchReport({
    ...overview.researchReports[0],
    id: testReportId,
    title: "PostgreSQL Storage Research Persistence",
    generatedAt: new Date().toISOString(),
    verification: {
      ...overview.researchReports[0].verification,
      id: testVerificationId,
    },
  });
  const overviewAfterReport = await storage.getMarketPilotOverview();
  const storedReport = overviewAfterReport.researchReports.find((report) => report.id === savedReport.id);
  assert.ok(storedReport, "saved report should be readable from PostgreSQL");
  assert.equal(storedReport?.id, savedReport.id);
  assert.equal(storedReport?.title, "PostgreSQL Storage Research Persistence");
  assert.equal(storedReport?.verification.id, testVerificationId);

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

  const reliabilityA = new PgTransactionalReliabilityRepository(process.env.DATABASE_URL);
  const reliabilityB = new PgTransactionalReliabilityRepository(process.env.DATABASE_URL);
  const reliabilityKey = `pg-reliability-${Date.now()}`;
  assert.equal((await reliabilityA.reserveSubmission(reliabilityKey, "fingerprint", "owner-a")).status, "acquired");
  assert.equal((await reliabilityB.reserveSubmission(reliabilityKey, "fingerprint", "owner-b")).status, "in_doubt");
  await reliabilityA.resolveSubmission(reliabilityKey, "record_not_submitted", "integration-test");
  const strategyId = `pg-lease-${Date.now()}`;
  await reliabilityA.acquireLease(strategyId, "worker-a", 30_000);
  await assert.rejects(() => reliabilityB.acquireLease(strategyId, "worker-b", 30_000), /another runtime/);
  await reliabilityA.releaseLease(strategyId, "worker-a");
  await reliabilityB.acquireLease(strategyId, "worker-b", 30_000);
  await reliabilityB.releaseLease(strategyId, "worker-b");
  await reliabilityA.close();
  await reliabilityB.close();

  const governance = new PgGovernanceRepository(process.env.DATABASE_URL);
  const approvalId = `pg-governance-${Date.now()}`;
  await governance.saveApproval({
    id: approvalId,
    requestedBy: "integration-owner",
    justification: "Integration test governance request with bounded sandbox scope.",
    status: "pending",
    scope: { strategyIds: ["integration-strategy"], sandboxOnly: true },
    reviews: [],
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
  });
  await governance.mutateApproval(approvalId, (approval) => ({ ...approval, status: "approved" }));
  assert.equal((await governance.getApproval<{ status: string }>(approvalId))?.status, "approved");
  await governance.saveExecutionAudit({
    id: `pg-audit-${Date.now()}`,
    action: "integration.audit",
    outcome: "accepted",
    correlationId: approvalId,
    detail: { durable: true },
    createdAt: new Date().toISOString(),
  });
  assert.ok((await governance.listExecutionAudits()).some((entry) => entry.correlationId === approvalId));
  await governance.saveAuditExport({
    id: `pg-export-${Date.now()}`,
    artifactDigest: "c".repeat(64),
    previousArtifactDigest: null,
    signature: null,
    signatureAlgorithm: "unsigned-sha256",
    eventCount: 1,
    auditEntryCount: 1,
    storageLocation: "/tmp/primary.json",
    archiveLocation: "/tmp/archive.json",
    generatedBy: "integration-owner",
    generatedAt: new Date().toISOString(),
  });
  assert.ok((await governance.listAuditExports<{ archiveLocation: string | null }>())
    .some((entry) => entry.archiveLocation === "/tmp/archive.json"));
  await governance.close();

  const eventStore = new PgEventLogStore(process.env.DATABASE_URL);
  await eventStore.append({
    id: `pg-event-${Date.now()}`,
    version: 1,
    type: "automation.approval_requested",
    correlationId: approvalId,
    causationId: null,
    userId: "integration-owner",
    sourceService: "pg-integration",
    payloadHash: "a".repeat(64),
    payload: { durable: true },
    createdAt: new Date().toISOString(),
  });
  assert.ok((await eventStore.list(10)).some((event) => event.correlationId === approvalId));
  await eventStore.close();

  const demoRunStoreA = new DemoRunRecordStore(process.env.DATABASE_URL);
  demoRunId = `pg-demo-run-${Date.now()}`;
  stoppedDemoRunId = `${demoRunId}-stopped`;
  await demoRunStoreA.save({
    runId: demoRunId,
    mode: "demo_observation",
    state: "running",
    startTime: new Date().toISOString(),
    endTime: null,
    pausedAt: null,
    allowedSymbols: ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"],
    allowedStrategies: ["integration-strategy"],
    connectedProviders: ["MarketPilot Internal Analysis Tools"],
    riskLimits: {
      maxDailyLoss: 250,
      maxOpenPositions: 2,
      maxTradesPerDay: 5,
      confidenceThreshold: 60,
    },
    dailyReports: [{
      day: 1,
      date: new Date().toISOString().slice(0, 10),
      reliabilityScore: 100,
      safetyScore: 100,
      usabilityScore: 90,
      calibrationScore: 80,
      strategyPerformanceScore: 70,
      riskScore: 100,
      recommendedChanges: ["Continue observing."],
      topStrategies: [],
      weakStrategies: [],
      retirementCandidates: [],
    }],
    adjustments: [],
    screenVisits: [["/system", 1]],
    finalReport: null,
  });
  await demoRunStoreA.save({
    runId: stoppedDemoRunId,
    mode: "demo_observation",
    state: "stopped",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    pausedAt: null,
    allowedSymbols: ["EUR/USD"],
    allowedStrategies: [],
    connectedProviders: [],
    riskLimits: {
      maxDailyLoss: 250,
      maxOpenPositions: 2,
      maxTradesPerDay: 5,
      confidenceThreshold: 60,
    },
    dailyReports: [],
    adjustments: [],
    screenVisits: [],
    finalReport: null,
  });
  const demoRunStoreB = new DemoRunRecordStore(process.env.DATABASE_URL);
  const bootstrappedDemoRun = await demoRunStoreB.loadLatest();
  assert.equal(bootstrappedDemoRun?.runId, demoRunId);
  assert.equal(bootstrappedDemoRun?.state, "running");
  assert.deepEqual(bootstrappedDemoRun?.screenVisits, [["/system", 1]]);

  const vectorStore = new PgVectorStore(process.env.DATABASE_URL);
  await vectorStore.upsert({
    id: `pg-vector-${Date.now()}`,
    text: "SPY rates and dollar risk",
    vector: [1, 0, 0],
    metadata: { kind: "research_report", timestamp: new Date().toISOString() },
  });
  const vectorResults = await vectorStore.search([1, 0, 0], 1);
  assert.equal(vectorResults[0]?.id.startsWith("pg-vector-"), true);
  await vectorStore.close();

  console.log("pgStorage integration tests passed");
} finally {
  await cleanupClient.connect();
  await cleanupClient.query("DELETE FROM research_reports WHERE id = $1", [testReportId]);
  await cleanupClient.query("DELETE FROM verification_checks WHERE id = $1", [testVerificationId]);
  await cleanupClient.query("DELETE FROM audit_logs WHERE target = $1 AND action = 'generated_research_report'", [testReportId]);
  if (demoRunId) await cleanupClient.query("DELETE FROM demo_run_records WHERE run_id = $1", [demoRunId]);
  if (stoppedDemoRunId) await cleanupClient.query("DELETE FROM demo_run_records WHERE run_id = $1", [stoppedDemoRunId]);
  await cleanupClient.end();
}
