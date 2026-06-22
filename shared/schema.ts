import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, real, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const proficiencyScores = pgTable("proficiency_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  score: integer("score").notNull(),
  unlocks: jsonb("unlocks").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const learningModules = pgTable("learning_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stage: text("stage").notNull(),
  title: text("title").notNull(),
  domain: text("domain").notNull(),
  level: text("level").notNull(),
  progress: integer("progress").notNull().default(0),
  requiredScore: integer("required_score").notNull().default(60),
  status: text("status").notNull().default("locked"),
  lessons: integer("lessons").notNull().default(1),
  gates: jsonb("gates").$type<string[]>().notNull().default([]),
});

export const quizResults = pgTable("quiz_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  category: text("category").notNull(),
  score: integer("score").notNull(),
  passed: boolean("passed").notNull().default(false),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  feedback: jsonb("feedback").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const verificationChecks = pgTable("verification_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull(),
  evidenceSummary: text("evidence_summary").notNull(),
  contradictoryEvidence: jsonb("contradictory_evidence").$type<string[]>().notNull().default([]),
  whatWouldDisprove: text("what_would_disprove").notNull(),
  sources: jsonb("sources").$type<Array<{ name: string; url?: string; timestamp: string; reliability: string }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const researchReports = pgTable("research_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  verificationCheckId: varchar("verification_check_id"),
  agent: text("agent").notNull(),
  title: text("title").notNull(),
  asset: text("asset"),
  summary: text("summary").notNull(),
  mainCause: text("main_cause").notNull(),
  secondaryCauses: jsonb("secondary_causes").$type<string[]>().notNull().default([]),
  riskFactors: jsonb("risk_factors").$type<string[]>().notNull().default([]),
  classification: text("classification").notNull(),
  confidence: integer("confidence").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const agentOutputs = pgTable("agent_outputs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agent: text("agent").notNull(),
  title: text("title").notNull(),
  assetFocus: text("asset_focus"),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  observations: jsonb("observations").$type<string[]>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  risks: jsonb("risks").$type<string[]>().notNull().default([]),
  citations: jsonb("citations").$type<Array<{ name: string; timestamp: string; reliability: string }>>().notNull().default([]),
  confidence: integer("confidence").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const marketPrices = pgTable("market_prices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  price: real("price").notNull(),
  changePct: real("change_pct").notNull(),
  volumeTrend: text("volume_trend").notNull(),
  provider: text("provider").notNull(),
  observedAt: timestamp("observed_at").notNull(),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
});

export const economicEvents = pgTable("economic_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  category: text("category").notNull(),
  impact: text("impact").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  relatedAssets: jsonb("related_assets").$type<string[]>().notNull().default([]),
  source: text("source").notNull(),
  riskNote: text("risk_note").notNull(),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
});

export const newsArticles = pgTable("news_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  headline: text("headline").notNull(),
  source: text("source").notNull(),
  reliability: text("reliability").notNull(),
  sentiment: text("sentiment").notNull(),
  relatedSymbols: jsonb("related_symbols").$type<string[]>().notNull().default([]),
  publishedAt: timestamp("published_at").notNull(),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
});

export const riskRules = pgTable("risk_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  limit: text("limit").notNull(),
  status: text("status").notNull().default("active"),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const riskSettings = pgTable("risk_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  maxRiskPerTradePct: real("max_risk_per_trade_pct").notNull().default(1),
  reduceSizeAbovePct: real("reduce_size_above_pct").notNull().default(0.5),
  maxDailyLossPct: real("max_daily_loss_pct").notNull().default(2),
  maxWeeklyLossPct: real("max_weekly_loss_pct").notNull().default(4),
  maxSinglePositionPct: real("max_single_position_pct").notNull().default(15),
  maxOptionsPremiumPct: real("max_options_premium_pct").notNull().default(1),
  noTradeBeforeHighImpactEventHours: integer("no_trade_before_high_impact_event_hours").notNull().default(24),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const riskChecks = pgTable("risk_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeTicketId: varchar("trade_ticket_id"),
  decision: text("decision").notNull(),
  score: integer("score").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  requiredActions: jsonb("required_actions").$type<string[]>().notNull().default([]),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const paperPortfolios = pgTable("paper_portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  totalValue: real("total_value").notNull(),
  cash: real("cash").notNull(),
  ytdReturnPct: real("ytd_return_pct").notNull().default(0),
  maxDrawdownPct: real("max_drawdown_pct").notNull().default(0),
  riskScore: integer("risk_score").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const holdings = pgTable("holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  allocation: real("allocation").notNull(),
  value: real("value").notNull(),
  dailyChangePct: real("daily_change_pct").notNull().default(0),
  riskContribution: real("risk_contribution").notNull().default(0),
});

export const tradeTickets = pgTable("trade_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  verificationCheckId: varchar("verification_check_id"),
  riskCheckId: varchar("risk_check_id"),
  asset: text("asset").notNull(),
  direction: text("direction").notNull(),
  quantity: real("quantity").notNull(),
  entryPrice: real("entry_price").notNull(),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  timeHorizon: text("time_horizon").notNull(),
  rationale: text("rationale").notNull(),
  supportingEvidence: jsonb("supporting_evidence").$type<string[]>().notNull().default([]),
  portfolioImpact: text("portfolio_impact").notNull().default(""),
  alternativeChoices: jsonb("alternative_choices").$type<string[]>().notNull().default([]),
  exitCriteria: text("exit_criteria").notNull().default(""),
  invalidationCondition: text("invalidation_condition").notNull().default(""),
  status: text("status").notNull(),
  riskAmount: real("risk_amount").notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const journalEntries = pgTable("journal_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  linkedTicketId: varchar("linked_ticket_id"),
  title: text("title").notNull(),
  qualityScore: integer("quality_score").notNull().default(0),
  notes: text("notes").notNull(),
  lessons: jsonb("lessons").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const journalReviews = pgTable("journal_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  journalEntryId: varchar("journal_entry_id").notNull(),
  qualityScore: integer("quality_score").notNull(),
  mistakePatterns: jsonb("mistake_patterns").$type<string[]>().notNull().default([]),
  disciplineSignals: jsonb("discipline_signals").$type<string[]>().notNull().default([]),
  feedback: jsonb("feedback").$type<string[]>().notNull().default([]),
  proficiencyCategory: text("proficiency_category").notNull(),
  proficiencyDelta: integer("proficiency_delta").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memoryRecords = pgTable("memory_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const strategyEvidenceRecords = pgTable("strategy_evidence_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  kind: text("kind").notNull(),
  verdict: text("verdict"),
  symbol: text("symbol"),
  regime: text("regime"),
  timeframe: text("timeframe"),
  timestamp: timestamp("timestamp").notNull(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  outcome: text("outcome"),
  relatedIds: jsonb("related_ids").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export const ragRuns = pgTable("rag_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  query: text("query").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  confidence: integer("confidence").notNull(),
  sourceFreshness: text("source_freshness").notNull(),
  citationIds: jsonb("citation_ids").$type<string[]>().notNull().default([]),
  chunkIds: jsonb("chunk_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ragDocuments = pgTable("rag_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  runId: varchar("run_id").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  timestamp: timestamp("timestamp").notNull(),
  chunkIds: jsonb("chunk_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aiEvaluations = pgTable("ai_evaluations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  artifactId: varchar("artifact_id").notNull(),
  artifactType: text("artifact_type").notNull(),
  promptVersion: text("prompt_version").notNull(),
  outputSummary: text("output_summary").notNull(),
  overallScore: integer("overall_score").notNull(),
  requiredActions: jsonb("required_actions").$type<string[]>().notNull().default([]),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const ingestionRuns = pgTable("ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at").notNull(),
  records: integer("records").notNull(),
  freshnessNewestTimestamp: timestamp("freshness_newest_timestamp"),
  freshnessOldestTimestamp: timestamp("freshness_oldest_timestamp"),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
});

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull().default("active"),
  relatedAssets: jsonb("related_assets").$type<string[]>().notNull().default([]),
  requiredActions: jsonb("required_actions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orderPreviews = pgTable("order_previews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeTicketId: varchar("trade_ticket_id").notNull(),
  userId: varchar("user_id").notNull(),
  broker: text("broker").notNull(),
  environment: text("environment").notNull(),
  estimatedNotional: real("estimated_notional").notNull(),
  estimatedFees: real("estimated_fees").notNull(),
  estimatedSlippage: real("estimated_slippage").notNull(),
  estimatedTotalCost: real("estimated_total_cost").notNull(),
  buyingPowerImpact: real("buying_power_impact").notNull(),
  marginRequirement: real("margin_requirement").notNull(),
  liquidityCheck: text("liquidity_check").notNull(),
  liveExecutionBlocked: boolean("live_execution_blocked").notNull().default(true),
  complianceAcknowledgementRequired: boolean("compliance_acknowledgement_required").notNull().default(true),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  approvalSteps: jsonb("approval_steps").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const brokerConnections = pgTable("broker_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  broker: text("broker").notNull(),
  environment: text("environment").notNull(),
  connectionStatus: text("connection_status").notNull(),
  readOnly: boolean("read_only").notNull().default(true),
  credentialsVaulted: boolean("credentials_vaulted").notNull().default(false),
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  deviceVerified: boolean("device_verified").notNull().default(false),
  sessionFresh: boolean("session_fresh").notNull().default(false),
  adminUnlock: boolean("admin_unlock").notNull().default(false),
  userUnlock: boolean("user_unlock").notNull().default(false),
  liveTradingEnabled: boolean("live_trading_enabled").notNull().default(false),
  requiredActions: jsonb("required_actions").$type<string[]>().notNull().default([]),
  lastCheckedAt: timestamp("last_checked_at").notNull().defaultNow(),
});

export const complianceProfiles = pgTable("compliance_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  disclosuresAccepted: boolean("disclosures_accepted").notNull().default(false),
  disclosureVersion: text("disclosure_version").notNull().default("marketpilot-risk-v1"),
  acceptedAt: timestamp("accepted_at"),
  userConfirmation: text("user_confirmation"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const learningStageSchema = z.enum([
  "foundation",
  "research_paper",
  "supervised_live",
]);

export const unlockStatusSchema = z.enum(["locked", "available", "unlocked"]);
export const verificationStatusSchema = z.enum([
  "verified",
  "partially_verified",
  "not_verified",
  "conflicting_evidence",
  "requires_human_review",
]);
export const riskDecisionSchema = z.enum([
  "approve",
  "reject",
  "reduce_size",
  "require_more_research",
  "require_quiz",
  "cooling_off",
]);
export const ticketStatusSchema = z.enum([
  "draft",
  "proposed",
  "paper_approved",
  "risk_rejected",
  "user_rejected",
  "paper_filled",
  "closed",
]);

export const proficiencyCategorySchema = z.enum([
  "market_basics",
  "macroeconomics",
  "stocks",
  "etfs",
  "bonds",
  "forex",
  "options",
  "technical_analysis",
  "fundamental_analysis",
  "risk_management",
  "portfolio_construction",
  "trading_psychology",
  "execution_mechanics",
]);

export const learningModuleSchema = z.object({
  id: z.string(),
  stage: learningStageSchema,
  title: z.string(),
  domain: z.string(),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  progress: z.number().min(0).max(100),
  requiredScore: z.number().min(0).max(100),
  status: unlockStatusSchema,
  lessons: z.number().int().positive(),
  gates: z.array(z.string()),
});

export const proficiencyScoreSchema = z.object({
  id: z.string(),
  category: proficiencyCategorySchema,
  label: z.string(),
  score: z.number().min(0).max(100),
  unlocks: z.array(z.string()),
  evidence: z.array(z.string()),
  updatedAt: z.string(),
});

export const progressionSchema = z.object({
  currentStage: learningStageSchema,
  stageLabel: z.string(),
  nextStage: learningStageSchema.nullable(),
  paperTradingUnlock: unlockStatusSchema,
  liveTradingUnlock: unlockStatusSchema,
  requirementsToAdvance: z.array(z.string()),
  blockedBy: z.array(z.string()),
});

export const evidenceSourceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  timestamp: z.string(),
  reliability: z.enum(["high", "medium", "low"]),
});

export const verificationCheckSchema = z.object({
  id: z.string(),
  status: verificationStatusSchema,
  confidence: z.number().min(0).max(100),
  evidenceSummary: z.string(),
  contradictoryEvidence: z.array(z.string()),
  whatWouldDisprove: z.string(),
  sources: z.array(evidenceSourceSchema),
});

export const verificationQualityReportSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  status: z.enum(["verified", "partially_verified", "conflicting", "requires_review"]),
  score: z.number().min(0).max(100),
  freshnessScore: z.number().min(0).max(100),
  evidenceWeightScore: z.number().min(0).max(100),
  contradictionScore: z.number().min(0).max(100),
  hallucinationRiskScore: z.number().min(0).max(100),
  sampledClaims: z.number().int().nonnegative(),
  sourceCoverage: z.object({
    totalSources: z.number().int().nonnegative(),
    highReliability: z.number().int().nonnegative(),
    mediumReliability: z.number().int().nonnegative(),
    lowReliability: z.number().int().nonnegative(),
    staleSources: z.array(z.string()),
  }),
  evidence: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

export const researchReportSchema = z.object({
  id: z.string(),
  agent: z.enum(["macro", "equity", "etf", "options", "forex", "commodities", "bonds", "portfolio", "risk", "verification"]),
  title: z.string(),
  asset: z.string().optional(),
  summary: z.string(),
  mainCause: z.string(),
  secondaryCauses: z.array(z.string()),
  riskFactors: z.array(z.string()),
  classification: z.enum(["fact", "interpretation", "prediction"]),
  confidence: z.number().min(0).max(100),
  generatedAt: z.string(),
  verification: verificationCheckSchema,
});

export const marketMovementExplanationSchema = z.object({
  symbol: z.string(),
  primaryCause: z.string(),
  mainCause: z.string(),
  secondaryCauses: z.array(z.string()),
  facts: z.array(z.string()),
  interpretations: z.array(z.string()),
  predictions: z.array(z.string()),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  contradictoryEvidence: z.array(z.string()),
  whatWouldInvalidate: z.string(),
  whatCouldReverse: z.string(),
  affectedAssets: z.array(z.string()),
  relatedAssets: z.array(z.string()),
  riskFactors: z.array(z.string()),
  whatWouldStrengthen: z.array(z.string()).default([]),
  whatWouldWeaken: z.array(z.string()).default([]),
  alternativeExplanations: z.array(z.string()).default([]),
  consensusScore: z.number().min(0).max(100).default(0),
  agentAgreementScore: z.number().min(0).max(100).default(0),
  historicalAnalogues: z.array(z.string()).default([]),
  pastSimilarEvents: z.array(z.string()).default([]),
  scenarioProbabilities: z.array(z.object({
    scenario: z.string(),
    probabilityPct: z.number().min(0).max(100),
  })).default([]),
  sourceTimestamps: z.array(evidenceSourceSchema),
  verification: verificationCheckSchema,
});

export const agentNameSchema = z.enum([
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

export const agentOutputSchema = z.object({
  id: z.string(),
  agent: agentNameSchema,
  title: z.string(),
  assetFocus: z.string().optional(),
  status: z.enum(["clear", "watch", "action_required", "blocked"]),
  summary: z.string(),
  observations: z.array(z.string()),
  recommendations: z.array(z.string()),
  risks: z.array(z.string()),
  citations: z.array(z.object({
    name: z.string(),
    timestamp: z.string(),
    reliability: z.enum(["high", "medium", "low"]),
  })),
  confidence: z.number().min(0).max(100),
  generatedAt: z.string(),
});

export const supervisorWorkflowStepSchema = z.object({
  id: z.enum([
    "idea",
    "verification",
    "risk",
    "portfolio_impact",
    "compliance",
    "human_approval",
    "execution",
  ]),
  label: z.string(),
  status: z.enum(["complete", "blocked", "pending", "not_applicable"]),
  gateOwner: z.enum([
    "supervisor",
    "verification_agent",
    "risk_officer",
    "portfolio_agent",
    "compliance_officer",
    "human",
    "execution_officer",
  ]),
  evidence: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

export const supervisorTicketReviewSchema = z.object({
  ticketId: z.string(),
  asset: z.string(),
  status: ticketStatusSchema,
  canRequestPaperPreview: z.boolean(),
  canPlaceLiveOrder: z.literal(false),
  riskOfficerVeto: z.boolean(),
  humanApprovalRequired: z.boolean(),
  steps: z.array(supervisorWorkflowStepSchema),
});

export const supervisorReportSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  mode: z.enum(["paper_supervision", "live_blocked"]),
  workflow: z.array(supervisorWorkflowStepSchema.shape.id),
  summary: z.string(),
  blockedCapabilities: z.array(z.string()),
  ticketReviews: z.array(supervisorTicketReviewSchema),
  requiredActions: z.array(z.string()),
});

export const alertSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  category: z.enum(["event_risk", "proficiency_gate", "risk_rule", "portfolio_drift", "verification"]),
  title: z.string(),
  message: z.string(),
  trigger: z.string(),
  status: z.enum(["active", "acknowledged", "resolved"]),
  relatedAssets: z.array(z.string()),
  requiredActions: z.array(z.string()),
  createdAt: z.string(),
});

export const marketPriceSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  price: z.number(),
  changePct: z.number(),
  volumeTrend: z.enum(["rising", "flat", "falling"]),
  provider: z.string(),
  observedAt: z.string(),
  ingestedAt: z.string(),
});

export const economicEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["macro", "earnings", "central_bank", "liquidity"]),
  impact: z.enum(["low", "medium", "high"]),
  startsAt: z.string(),
  relatedAssets: z.array(z.string()),
  source: z.string(),
  riskNote: z.string(),
  ingestedAt: z.string(),
});

export const newsArticleSchema = z.object({
  id: z.string(),
  headline: z.string(),
  source: z.string(),
  reliability: z.enum(["high", "medium", "low"]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  relatedSymbols: z.array(z.string()),
  publishedAt: z.string(),
  ingestedAt: z.string(),
});

export const ingestionSnapshotSchema = z.object({
  generatedAt: z.string(),
  providerMode: z.enum(["demo", "live_disabled"]),
  marketPrices: z.array(marketPriceSchema),
  economicEvents: z.array(economicEventSchema),
  newsArticles: z.array(newsArticleSchema),
  freshness: z.object({
    staleItems: z.array(z.string()),
    newestTimestamp: z.string().nullable(),
    oldestTimestamp: z.string().nullable(),
  }),
  requiredActions: z.array(z.string()),
});

export const scheduledMarketBriefingSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  symbols: z.array(z.string()),
  reports: z.array(researchReportSchema),
  freshness: z.object({
    maxSourceAgeMinutes: z.number(),
    staleSources: z.array(z.string()),
  }),
  verificationSummary: z.object({
    verified: z.number().int().nonnegative(),
    partiallyVerified: z.number().int().nonnegative(),
    requiresReview: z.number().int().nonnegative(),
  }),
  requiredActions: z.array(z.string()),
});

export const riskRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  limit: z.string(),
  status: z.enum(["active", "warning", "breached"]),
  description: z.string(),
});

const riskSettingsBaseSchema = z.object({
  id: z.string(),
  maxRiskPerTradePct: z.number().positive().max(5),
  reduceSizeAbovePct: z.number().positive().max(5),
  maxDailyLossPct: z.number().positive().max(20),
  maxWeeklyLossPct: z.number().positive().max(30),
  maxSinglePositionPct: z.number().positive().max(100),
  maxOptionsPremiumPct: z.number().positive().max(20),
  noTradeBeforeHighImpactEventHours: z.number().int().positive().max(168),
  updatedAt: z.string(),
});

export const riskSettingsSchema = riskSettingsBaseSchema.refine((settings) => settings.reduceSizeAbovePct <= settings.maxRiskPerTradePct, {
  message: "Reduce-size threshold must be less than or equal to max risk per trade",
  path: ["reduceSizeAbovePct"],
});

export const riskSettingsUpdateSchema = riskSettingsBaseSchema.omit({
  id: true,
  updatedAt: true,
}).partial().refine((settings) => {
  if (settings.reduceSizeAbovePct === undefined || settings.maxRiskPerTradePct === undefined) return true;
  return settings.reduceSizeAbovePct <= settings.maxRiskPerTradePct;
}, {
  message: "Reduce-size threshold must be less than or equal to max risk per trade",
  path: ["reduceSizeAbovePct"],
});

export const riskCheckSchema = z.object({
  id: z.string(),
  decision: riskDecisionSchema,
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  requiredActions: z.array(z.string()),
  checkedAt: z.string(),
});

export const holdingSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  allocation: z.number(),
  value: z.number(),
  dailyChangePct: z.number(),
  riskContribution: z.number(),
});

export const paperPortfolioSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalValue: z.number(),
  cash: z.number(),
  ytdReturnPct: z.number(),
  maxDrawdownPct: z.number(),
  riskScore: z.number().min(0).max(100),
  holdings: z.array(holdingSchema),
});

export const portfolioRiskAnalyticsSchema = z.object({
  portfolioId: z.string(),
  generatedAt: z.string(),
  totalValue: z.number(),
  valueAtRisk95: z.number(),
  conditionalValueAtRisk95: z.number(),
  estimatedAnnualVolatilityPct: z.number(),
  maxDrawdownPct: z.number(),
  beta: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  liquidityScore: z.number().min(0).max(100),
  concentrationScore: z.number().min(0).max(100),
  largestPosition: z.object({
    symbol: z.string(),
    allocation: z.number(),
  }),
  correlationMatrix: z.array(z.object({
    pair: z.string(),
    correlation: z.number(),
  })),
  riskBreaches: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

export const tradeTicketSchema = z.object({
  id: z.string(),
  asset: z.string(),
  direction: z.enum(["buy", "sell", "short", "cover"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  timeHorizon: z.string(),
  rationale: z.string(),
  supportingEvidence: z.array(z.string()),
  riskAmount: z.number().nonnegative(),
  portfolioImpact: z.string(),
  alternativeChoices: z.array(z.string()),
  exitCriteria: z.string(),
  invalidationCondition: z.string(),
  confidence: z.number().min(0).max(100),
  status: ticketStatusSchema,
  verification: verificationCheckSchema,
  riskCheck: riskCheckSchema,
  createdAt: z.string(),
});

export const tradeTicketProposalSchema = z.object({
  asset: z.string().min(1),
  direction: z.enum(["buy", "sell", "short", "cover"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  timeHorizon: z.string().min(1),
  rationale: z.string().min(20),
  supportingEvidence: z.array(z.string().min(1)).min(1),
  alternativeChoices: z.array(z.string().min(1)).default([]),
  exitCriteria: z.string().min(1),
  invalidationCondition: z.string().min(1),
});

export const quizResultSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  category: proficiencyCategorySchema,
  score: z.number().int().min(0).max(100),
  passed: z.boolean(),
  answers: z.record(z.unknown()),
  feedback: z.array(z.string()),
  createdAt: z.string(),
});

export const quizSubmissionSchema = z.object({
  moduleId: z.string().min(1),
  category: proficiencyCategorySchema,
  score: z.number().int().min(0).max(100),
  answers: z.record(z.unknown()).default({}),
  reflection: z.string().min(12).optional(),
});

export const proficiencyAssessmentResultSchema = z.object({
  quizResult: quizResultSchema,
  previousScore: z.number().min(0).max(100),
  updatedScore: proficiencyScoreSchema,
  proficiencyDelta: z.number(),
  module: learningModuleSchema,
  passed: z.boolean(),
  unlocked: z.array(z.string()),
  remediation: z.array(z.string()),
  progression: progressionSchema,
});

export const paperTradeFillRequestSchema = z.object({
  complianceAcknowledged: z.literal(true),
  userConfirmation: z.string().min(12),
  previewId: z.string().optional(),
});

export const paperTradeCloseRequestSchema = z.object({
  exitPrice: z.number().positive(),
  exitReason: z.string().min(12),
  followedExitCriteria: z.boolean(),
  lessonsLearned: z.array(z.string().min(3)).min(1),
});

export const optionLegSchema = z.object({
  action: z.enum(["buy", "sell"]),
  type: z.enum(["call", "put"]),
  strike: z.number().positive(),
  premium: z.number().positive(),
  contracts: z.number().int().positive().default(1),
});

export const optionsSimulationRequestSchema = z.object({
  underlying: z.string().min(1),
  underlyingPrice: z.number().positive(),
  daysToExpiration: z.number().int().positive(),
  impliedVolatilityPct: z.number().positive(),
  legs: z.array(optionLegSchema).min(1).max(4),
});

export const optionsSimulationSchema = z.object({
  underlying: z.string(),
  strategyName: z.string(),
  underlyingPrice: z.number(),
  daysToExpiration: z.number(),
  impliedVolatilityPct: z.number(),
  netDebit: z.number(),
  maxLoss: z.number().nullable(),
  maxProfit: z.number().nullable(),
  breakevens: z.array(z.number()),
  priceRange: z.array(z.object({
    price: z.number(),
    payoff: z.number(),
  })),
  riskRewardSummary: z.string(),
  assignmentRisk: z.string(),
  proficiencyGate: z.object({
    requiredScore: z.number(),
    currentScore: z.number(),
    unlocked: z.boolean(),
    requiredActions: z.array(z.string()),
  }),
  safetyNotes: z.array(z.string()),
});

export const backtestAllocationSchema = z.object({
  symbol: z.string().min(1),
  targetPct: z.number().min(0).max(100),
});

export const backtestRequestSchema = z.object({
  strategyName: z.string().min(1),
  startYear: z.number().int().min(2000).max(2026),
  endYear: z.number().int().min(2000).max(2026),
  initialCapital: z.number().positive(),
  monthlyContribution: z.number().nonnegative().default(0),
  rebalanceFrequency: z.enum(["none", "annual", "quarterly"]),
  allocation: z.array(backtestAllocationSchema).min(1).max(8),
}).superRefine((request, context) => {
  if (request.endYear < request.startYear) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End year must be greater than or equal to start year",
      path: ["endYear"],
    });
  }

  const total = request.allocation.reduce((sum, item) => sum + item.targetPct, 0);
  if (Math.abs(total - 100) > 0.5) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Allocation targets must total 100%",
      path: ["allocation"],
    });
  }
});

export const backtestResultSchema = z.object({
  strategyName: z.string(),
  startYear: z.number(),
  endYear: z.number(),
  initialCapital: z.number(),
  monthlyContribution: z.number(),
  totalContributions: z.number(),
  finalValue: z.number(),
  cumulativeReturnPct: z.number(),
  annualizedReturnPct: z.number(),
  volatilityPct: z.number(),
  maxDrawdownPct: z.number(),
  sharpeRatio: z.number(),
  bestYear: z.object({
    year: z.number(),
    returnPct: z.number(),
  }),
  worstYear: z.object({
    year: z.number(),
    returnPct: z.number(),
  }),
  annualResults: z.array(z.object({
    year: z.number(),
    contribution: z.number(),
    endingValue: z.number(),
    returnPct: z.number(),
    drawdownPct: z.number(),
  })),
  riskBreaches: z.array(z.string()),
  requiredActions: z.array(z.string()),
  notes: z.array(z.string()),
});

export const orderPreviewSchema = z.object({
  id: z.string(),
  tradeTicketId: z.string(),
  broker: z.enum(["marketpilot_paper_broker", "interactive_brokers_disabled"]),
  environment: z.enum(["paper", "live_disabled"]),
  estimatedNotional: z.number(),
  estimatedFees: z.number(),
  estimatedSlippage: z.number(),
  estimatedTotalCost: z.number(),
  buyingPowerImpact: z.number(),
  marginRequirement: z.number(),
  liquidityCheck: z.enum(["pass", "warning", "fail"]),
  liveExecutionBlocked: z.boolean(),
  complianceAcknowledgementRequired: z.boolean(),
  warnings: z.array(z.string()),
  approvalSteps: z.array(z.string()),
  createdAt: z.string(),
});

export const brokerReadinessCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "fail", "warning"]),
  detail: z.string(),
  requiredAction: z.string().optional(),
});

export const brokerReadinessSchema = z.object({
  broker: z.enum(["interactive_brokers", "paper_broker"]),
  connectionStatus: z.enum(["not_connected", "read_only_ready", "paper_ready", "blocked"]),
  liveExecutionAllowed: z.boolean(),
  paperOnly: z.boolean(),
  checks: z.array(brokerReadinessCheckSchema),
  requiredActions: z.array(z.string()),
  vault: z.object({
    provider: z.enum(["not_configured", "env_vault", "external_vault"]),
    credentialsStored: z.boolean(),
    rotationRequired: z.boolean(),
  }),
  readOnlyRequired: z.boolean(),
  mfaRequired: z.boolean(),
  deviceVerificationRequired: z.boolean(),
  sessionTimeoutMinutes: z.number().int().positive(),
  generatedAt: z.string(),
});

export const liveAssistancePolicySchema = z.object({
  status: z.enum(["blocked", "eligible_read_only", "enabled"]),
  canRequestLivePreview: z.boolean(),
  canPlaceLiveOrder: z.boolean(),
  currentStage: learningStageSchema,
  requiredActions: z.array(z.string()),
  prohibitedCapabilities: z.array(z.string()),
  complianceNotices: z.array(z.string()),
  riskOfficerVeto: z.boolean(),
  generatedAt: z.string(),
});

export const securityControlSchema = z.object({
  id: z.enum([
    "mfa",
    "credential_vault",
    "rbac",
    "session_timeout",
    "device_verification",
    "audit_logs",
    "rate_limits",
    "environment_separation",
    "paper_live_separation",
  ]),
  label: z.string(),
  status: z.enum(["pass", "warning", "fail"]),
  evidence: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

export const securityPostureReportSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  status: z.enum(["pass", "warning", "fail"]),
  score: z.number().min(0).max(100),
  controls: z.array(securityControlSchema),
  requiredActions: z.array(z.string()),
  liveExecutionBlocked: z.boolean(),
});

export const marketPilotEventSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  type: z.enum([
    "learning.progress_recorded",
    "proficiency.score_changed",
    "research.report_generated",
    "verification.completed",
    "risk.check_completed",
    "portfolio.model_evaluated",
    "trade.idea_created",
    "trade.ticket_created",
    "approval.requested",
    "approval.granted",
    "approval.denied",
    "paper.order_previewed",
    "paper.order_filled",
    "journal.entry_created",
    "supervisor.workflow_completed",
    "rate_limit.triggered",
    "security.posture_updated",
    "evaluation.completed",
    "market.explanation_generated",
    "rag.context_built",
    "provider.ingestion_run",
    "sandbox.account_synced",
    "sandbox.order_completed",
    "sandbox.reconciliation_completed",
    "sandbox.idempotency_resolved",
    "price.tick_received",
    "market.candle_closed",
    "strategy.signal_evaluated",
    "knowledge.graph_built",
    "analytics.snapshot_recorded",
    "analytics.model_validation_recorded",
    "paper.trade_closed",
    "post_trade.review_completed",
    "event_blackout.evaluated",
    "strategy.lifecycle_evaluated",
    "strategy.lease_changed",
    "provider.recovery_attempted",
    "provider.recovery_completed",
    "automation.approval_requested",
    "automation.approval_reviewed",
    "automation.approval_revoked",
    "production.resilience_recorded",
    "audit.export_generated",
    "controlled_live.quiz_recorded",
    "controlled_live.permission_evaluated",
    "controlled_live.preview_created",
    "controlled_live.confirmation_recorded",
    "controlled_live.sandbox_submitted",
    "telegram.command_requested",
    "telegram.command_confirmed",
    "telegram.command_rejected",
    "telegram.alert_sent",
    "connector.action_requested",
    "connector.action_completed",
    "connector.health_checked",
    "demo.run_started",
    "demo.run_paused",
    "demo.run_resumed",
    "demo.run_stopped",
    "demo.run_daily_evaluated",
    "demo.run_adjusted",
    "demo.run_report_generated",
    "demo.screen_visited",
  ]),
  correlationId: z.string(),
  causationId: z.string().nullable(),
  userId: z.string(),
  sourceService: z.string(),
  payloadHash: z.string(),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});

export const eventLogSnapshotSchema = z.object({
  generatedAt: z.string(),
  eventCount: z.number().int().nonnegative(),
  latestEventAt: z.string().nullable(),
  events: z.array(marketPilotEventSchema),
});

export const providerCapabilitySchema = z.enum([
  "quotes",
  "historical_prices",
  "economic_events",
  "news",
  "filings",
  "options_chain",
  "broker_account",
  "broker_orders",
]);

export const providerHealthSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["market_data", "economic_data", "news", "filings", "options_data", "broker_data"]),
  status: z.enum(["healthy", "degraded", "disabled"]),
  capabilities: z.array(providerCapabilitySchema),
  providerMode: z.enum(["demo", "external_disabled", "external_configured"]),
  freshness: z.object({
    newestTimestamp: z.string().nullable(),
    oldestTimestamp: z.string().nullable(),
    stale: z.boolean(),
  }),
  confidence: z.number().min(0).max(100),
  requiredActions: z.array(z.string()),
  checkedAt: z.string(),
});

export const providerRegistrySnapshotSchema = z.object({
  generatedAt: z.string(),
  providers: z.array(providerHealthSchema),
});

export const memoryRecordSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "research_report",
    "market_explanation",
    "trade_journal",
    "lesson_learned",
    "agent_decision",
    "supervisor_workflow",
  ]),
  text: z.string(),
  tags: z.array(z.string()),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export const historicalAnalogueSchema = z.object({
  id: z.string(),
  kind: memoryRecordSchema.shape.kind,
  title: z.string(),
  summary: z.string(),
  whySimilar: z.string(),
  lesson: z.string(),
  sourceTags: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  createdAt: z.string(),
});

export const memoryHealthSchema = z.object({
  generatedAt: z.string(),
  shortTerm: z.object({
    provider: z.enum(["memory", "redis_disabled"]),
    records: z.number().int().nonnegative(),
    status: z.enum(["healthy", "disabled"]),
  }),
  longTerm: z.object({
    provider: z.enum(["memory", "postgres_available", "postgres_unavailable"]),
    records: z.number().int().nonnegative(),
    status: z.enum(["healthy", "degraded", "disabled"]),
  }),
  semantic: z.object({
    provider: z.enum(["memory", "qdrant_disabled"]),
    records: z.number().int().nonnegative(),
    status: z.enum(["healthy", "disabled"]),
  }),
});

export const storageHealthSchema = z.object({
  generatedAt: z.string(),
  mode: z.enum(["memory", "postgres"]),
  status: z.enum(["healthy", "degraded", "unavailable"]),
  databaseUrlConfigured: z.boolean(),
  migrationVersion: z.string(),
  seedStrategy: z.string(),
  checks: z.array(z.object({
    id: z.string(),
    status: z.enum(["pass", "warning", "fail"]),
    detail: z.string(),
  })),
});

export const metricsSnapshotSchema = z.object({
  generatedAt: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  storageMode: z.enum(["memory", "postgres"]),
  requestCount: z.number().int().nonnegative(),
  rateLimitCount: z.number().int().nonnegative(),
  supervisorWorkflowCount: z.number().int().nonnegative(),
  verificationPassCount: z.number().int().nonnegative(),
  verificationFailCount: z.number().int().nonnegative(),
  riskApprovalCount: z.number().int().nonnegative(),
  riskRejectionCount: z.number().int().nonnegative(),
  paperTradeCount: z.number().int().nonnegative(),
  evaluationBenchmarkCount: z.number().int().nonnegative(),
  averageVerificationScore: z.number().min(0).max(100),
  averageHallucinationRiskScore: z.number().min(0).max(100),
  eventLogCount: z.number().int().nonnegative(),
});

export const knowledgeGraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    "ResearchReport",
    "MarketExplanation",
    "EconomicEvent",
    "Asset",
    "Sector",
    "Country",
    "CentralBank",
    "EarningsEvent",
    "TradeJournal",
    "LessonLearned",
    "RiskEvent",
    "PortfolioModel",
    "AgentDecision",
  ]),
  label: z.string(),
  timestamp: z.string(),
  confidence: z.number().min(0).max(100),
  sourceCount: z.number().int().nonnegative(),
  verificationStatus: verificationStatusSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const knowledgeGraphEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.enum([
    "caused_by",
    "supports",
    "contradicts",
    "affects",
    "similar_to",
    "references",
    "learned_from",
    "triggered",
  ]),
  confidence: z.number().min(0).max(100),
  timestamp: z.string(),
});

export const knowledgeGraphReportSchema = z.object({
  generatedAt: z.string(),
  nodes: z.array(knowledgeGraphNodeSchema),
  edges: z.array(knowledgeGraphEdgeSchema),
  traversal: z.object({
    startNodeId: z.string().nullable(),
    visitedNodeIds: z.array(z.string()),
    pathSummaries: z.array(z.string()),
  }),
});

export const crossAssetRelationshipSchema = z.object({
  left: z.string(),
  right: z.string(),
  relationship: z.enum(["positive", "inverse", "regime_sensitive", "weak"]),
  rollingCorrelation: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(100),
  regimeSensitivity: z.array(z.string()),
  affectedAssets: z.array(z.string()),
});

export const crossAssetRelationshipReportSchema = z.object({
  generatedAt: z.string(),
  relationships: z.array(crossAssetRelationshipSchema),
  concentrationWarnings: z.array(z.string()),
  affectedAssets: z.array(z.string()),
});

export const factorExposureReportSchema = z.object({
  generatedAt: z.string(),
  portfolioId: z.string(),
  exposures: z.object({
    marketBeta: z.number(),
    sector: z.record(z.number()),
    growthValue: z.number(),
    largeSmall: z.number(),
    duration: z.number(),
    inflationSensitivity: z.number(),
    currency: z.record(z.number()),
    commodity: z.number(),
  }),
  riskContributions: z.array(z.object({
    factor: z.string(),
    contributionPct: z.number(),
  })),
  concentrationWarnings: z.array(z.string()),
});

export const monteCarloSimulationReportSchema = z.object({
  generatedAt: z.string(),
  portfolioId: z.string(),
  simulationCount: z.number().int().positive(),
  horizonMonths: z.number().int().positive(),
  probabilityOfLossPct: z.number().min(0).max(100),
  valueAtRisk95: z.number(),
  conditionalValueAtRisk95: z.number(),
  medianEndingValue: z.number(),
  worstCaseEndingValue: z.number(),
  drawdownDistribution: z.array(z.object({
    percentile: z.number(),
    drawdownPct: z.number(),
  })),
  confidenceBands: z.array(z.object({
    month: z.number(),
    p10: z.number(),
    p50: z.number(),
    p90: z.number(),
  })),
  estimatedRecoveryMonths: z.number(),
  stressSummary: z.array(z.string()),
});

export const stressTestReportSchema = z.object({
  generatedAt: z.string(),
  portfolioId: z.string(),
  scenarios: z.array(z.object({
    id: z.enum(["2008", "covid_crash", "2022_inflation_shock", "oil_shock", "flash_crash", "rate_spike", "regional_banking_crisis"]),
    label: z.string(),
    estimatedLossPct: z.number(),
    estimatedLossValue: z.number(),
    estimatedDrawdownPct: z.number(),
    survivalScore: z.number().min(0).max(100),
    assetBehavior: z.array(z.string()),
  })),
  worstScenario: z.string(),
  requiredActions: z.array(z.string()),
});

export const greeksReportSchema = z.object({
  generatedAt: z.string(),
  underlying: z.string(),
  positionGreeks: z.object({
    delta: z.number(),
    gamma: z.number(),
    theta: z.number(),
    vega: z.number(),
    rho: z.number(),
  }),
  portfolioGreeks: z.object({
    delta: z.number(),
    gamma: z.number(),
    theta: z.number(),
    vega: z.number(),
    rho: z.number(),
  }),
  assignmentRisk: z.string(),
  volatilityExposure: z.string(),
  payoffPoints: z.array(z.object({
    underlyingPrice: z.number(),
    payoff: z.number(),
  })),
  riskSummary: z.array(z.string()),
});

export const regimeReportSchema = z.object({
  generatedAt: z.string(),
  primaryRegime: z.enum(["risk_on", "risk_off", "inflation", "disinflation", "growth", "recession", "high_volatility", "low_volatility", "rising_rate", "falling_rate"]),
  confidence: z.number().min(0).max(100),
  supportingEvidence: z.array(z.string()),
  contradictoryEvidence: z.array(z.string()),
  affectedAssetClasses: z.array(z.string()),
});

export const agentConsensusReportSchema = z.object({
  generatedAt: z.string(),
  consensusScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  agreement: z.array(z.string()),
  disagreement: z.array(z.string()),
  confidenceDispersion: z.number(),
  minorityOpinions: z.array(z.string()),
  conflictingEvidence: z.array(z.string()),
});

export const behavioralIntelligenceReportSchema = z.object({
  generatedAt: z.string(),
  behavioralScore: z.number().min(0).max(100),
  detectedPatterns: z.array(z.enum(["revenge_trading", "fomo", "overconfidence", "position_chasing", "strategy_hopping", "loss_aversion", "recency_bias"])),
  coolingOffRecommendations: z.array(z.string()),
  learningSuggestions: z.array(z.string()),
  riskPenalties: z.array(z.string()),
});

export const proficiencyGraphReportSchema = z.object({
  generatedAt: z.string(),
  nodes: z.array(z.object({
    id: proficiencyCategorySchema,
    label: z.string(),
    score: z.number().min(0).max(100),
    mastery: z.enum(["weak", "developing", "proficient", "advanced"]),
    mistakes: z.array(z.string()),
  })),
  edges: z.array(z.object({
    from: proficiencyCategorySchema,
    to: proficiencyCategorySchema,
    relationship: z.enum(["prerequisite", "dependency", "mastery_supports", "mistake_amplifies"]),
  })),
  adaptiveRecommendations: z.array(z.string()),
  unlockReadiness: z.array(z.string()),
  weaknessMap: z.array(z.string()),
  strengthMap: z.array(z.string()),
});

export const institutionalAnalyticsSnapshotSchema = z.object({
  generatedAt: z.string(),
  crossAsset: crossAssetRelationshipReportSchema,
  factors: factorExposureReportSchema,
  monteCarlo: monteCarloSimulationReportSchema,
  stress: stressTestReportSchema,
  greeks: greeksReportSchema,
  regime: regimeReportSchema,
  consensus: agentConsensusReportSchema,
  behavior: behavioralIntelligenceReportSchema,
  proficiencyGraph: proficiencyGraphReportSchema,
});

export const complianceProfileSchema = z.object({
  id: z.string(),
  disclosuresAccepted: z.boolean(),
  disclosureVersion: z.string(),
  acceptedAt: z.string().nullable(),
  userConfirmation: z.string().nullable(),
  requiredDisclosures: z.array(z.string()),
  updatedAt: z.string(),
});

export const complianceAcknowledgementSubmissionSchema = z.object({
  accepted: z.literal(true),
  disclosureVersion: z.string().min(1).default("marketpilot-risk-v1"),
  userConfirmation: z.string().min(20),
});

export const journalEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  linkedTicketId: z.string().optional(),
  qualityScore: z.number().min(0).max(100),
  notes: z.string(),
  lessons: z.array(z.string()),
  createdAt: z.string(),
});

export const paperTradeCloseResultSchema = z.object({
  ticket: tradeTicketSchema,
  journalEntry: journalEntrySchema,
  realizedPnl: z.number(),
  returnPct: z.number(),
});

export const journalReviewSchema = z.object({
  id: z.string(),
  journalEntryId: z.string(),
  qualityScore: z.number().int().min(0).max(100),
  mistakePatterns: z.array(z.string()),
  disciplineSignals: z.array(z.string()),
  feedback: z.array(z.string()),
  proficiencyCategory: proficiencyCategorySchema,
  proficiencyDelta: z.number(),
  createdAt: z.string(),
});

export const journalReviewSubmissionSchema = z.object({
  journalEntryId: z.string().min(1),
  reflection: z.string().min(40),
  followedPlan: z.boolean(),
  respectedStop: z.boolean(),
  positionSizingDiscipline: z.number().int().min(0).max(100),
  emotionalState: z.enum(["calm", "anxious", "impulsive", "revenge", "overconfident"]),
  lessonsLearned: z.array(z.string().min(3)).min(1),
});

export const journalReviewResultSchema = z.object({
  review: journalReviewSchema,
  journalEntry: journalEntrySchema,
  updatedScore: proficiencyScoreSchema,
  previousScore: z.number().min(0).max(100),
  progression: progressionSchema,
  remediation: z.array(z.string()),
  unlocked: z.array(z.string()),
});

export const auditLogSchema = z.object({
  id: z.string(),
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});

export const complianceAuditEventSchema = auditLogSchema.extend({
  sequence: z.number().int().positive(),
  digest: z.string(),
  previousDigest: z.string().nullable(),
});

export const complianceAuditSummarySchema = z.object({
  target: z.string().nullable(),
  generatedAt: z.string(),
  eventCount: z.number().int().nonnegative(),
  latestDigest: z.string().nullable(),
  completePaperFillChain: z.boolean(),
  evidence: z.object({
    riskEvaluation: z.boolean(),
    orderPreview: z.boolean(),
    complianceAcknowledgement: z.boolean(),
    paperFill: z.boolean(),
  }),
  missingEvidence: z.array(z.string()),
  events: z.array(complianceAuditEventSchema),
});

export const evaluationMetricSchema = z.object({
  id: z.enum([
    "research_quality",
    "citation_accuracy",
    "hallucination_risk",
    "confidence_calibration",
    "risk_discipline",
    "behavioral_discipline",
    "agent_agreement",
    "drawdown_control",
    "sharpe_quality",
    "sortino_quality",
  ]),
  label: z.string(),
  score: z.number().min(0).max(100),
  status: z.enum(["pass", "watch", "fail"]),
  target: z.number().min(0).max(100),
  evidence: z.array(z.string()),
  requiredActions: z.array(z.string()),
});

export const evaluationSuiteSchema = z.object({
  id: z.enum([
    "research_verification",
    "risk_performance",
    "behavioral_learning",
    "agent_reliability",
  ]),
  label: z.string(),
  objective: z.string(),
  status: z.enum(["pass", "watch", "fail"]),
  score: z.number().min(0).max(100),
  metrics: z.array(evaluationMetricSchema),
});

export const evaluationReportSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  overallScore: z.number().min(0).max(100),
  status: z.enum(["pass", "watch", "fail"]),
  benchmarkVersion: z.string(),
  suites: z.array(evaluationSuiteSchema),
  requiredActions: z.array(z.string()),
  monitoring: z.object({
    recommendedMetrics: z.array(z.string()),
    alertThresholds: z.array(z.string()),
  }),
  security: z.object({
    piiIncluded: z.boolean(),
    executionBlocked: z.boolean(),
    notes: z.array(z.string()),
  }),
});

export const assistantDomainSchema = z.enum([
  "forex",
  "stocks",
  "etfs",
  "options",
  "crypto",
  "bonds",
  "commodities",
  "portfolio",
  "loans",
  "credit",
  "interest_rates",
  "macroeconomics",
  "risk_management",
  "trading_psychology",
]);

export const decisionCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  asset: z.string().nullable(),
  situation: z.string(),
  mainConclusion: z.string(),
  confidence: z.number().min(0).max(100),
  suggestedAction: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "avoid"]),
  why: z.array(z.string()),
  whatCouldProveWrong: z.array(z.string()),
  learningNote: z.string(),
  verificationStatus: verificationStatusSchema,
  nextStep: z.string(),
  details: z.object({
    facts: z.array(z.string()),
    interpretations: z.array(z.string()),
    contradictoryEvidence: z.array(z.string()),
    risks: z.array(z.string()),
    verificationStatus: verificationStatusSchema,
    advancedAnalytics: z.array(z.string()),
  }),
});

export const signalPriorityInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["critical", "explanation", "risk_warning", "opportunity", "learning", "analytics"]),
  summary: z.string(),
  relevanceToGoal: z.number().min(0).max(100),
  marketImpact: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  freshness: z.number().min(0).max(100),
  portfolioExposure: z.number().min(0).max(100),
  riskSeverity: z.number().min(0).max(100),
  learningValue: z.number().min(0).max(100),
  actionability: z.number().min(0).max(100),
  details: z.array(z.string()).default([]),
});

export const prioritizedSignalSchema = signalPriorityInputSchema.extend({
  priorityScore: z.number().min(0).max(100),
  displayTier: z.enum(["primary", "secondary", "advanced", "hidden"]),
  reason: z.string(),
});

export const strategySuggestionSchema = z.object({
  id: z.string(),
  situationSummary: z.string(),
  possibleStrategy: z.string(),
  whyItMightWork: z.array(z.string()),
  whyItMightFail: z.array(z.string()),
  bestInstrument: z.string(),
  entryLogic: z.string(),
  exitLogic: z.string(),
  stopLossLogic: z.string(),
  positionSize: z.string(),
  riskReward: z.string(),
  timeHorizon: z.string(),
  confidence: z.number().min(0).max(100),
  requiredConfirmation: z.array(z.string()),
  saferAlternatives: z.array(z.string()),
  riskOfficerDecision: riskDecisionSchema,
});

export const marketMoveInvestigationSchema = z.object({
  id: z.string(),
  asset: z.string(),
  mainCause: z.string(),
  supportingEvidence: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  contradictoryEvidence: z.array(z.string()),
  whatToWatchNext: z.array(z.string()),
  tradeImplications: z.array(z.string()),
  facts: z.array(z.string()),
  interpretations: z.array(z.string()),
  whatWouldConfirm: z.array(z.string()),
  whatWouldDisprove: z.string(),
  decisionCard: decisionCardSchema,
});

export const tradingAssistantIntentSchema = z.enum([
  "market_move_explanation",
  "strategy_request",
  "portfolio_review",
  "learning_request",
  "credit_or_loan_question",
  "opportunity_scan",
  "risk_warning",
  "general_finance_question",
]);

export const tradingAssistantIntentClassificationSchema = z.object({
  intent: tradingAssistantIntentSchema,
  domain: assistantDomainSchema,
  assetCandidates: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  requiredData: z.array(z.string()),
  safetyConstraints: z.array(z.string()),
});

export const tradingAssistantRequestSchema = z.object({
  prompt: z.string().min(3),
  goal: z.string().optional(),
});

export const tradingAssistantResponseSchema = z.object({
  id: z.string(),
  intent: tradingAssistantIntentSchema,
  domain: assistantDomainSchema,
  intentClassification: tradingAssistantIntentClassificationSchema,
  decisionCard: decisionCardSchema,
  researchSummary: z.array(z.string()),
  strategyOptions: z.array(strategySuggestionSchema),
  riskCheck: z.object({
    decision: riskDecisionSchema,
    reasons: z.array(z.string()),
    requiredActions: z.array(z.string()),
  }),
  verificationStatus: verificationStatusSchema,
  learningNote: z.string(),
  predictionTrackingId: z.string(),
  historicalAnalogues: z.array(historicalAnalogueSchema),
  signals: z.array(prioritizedSignalSchema),
});

export const predictionRecordSchema = z.object({
  id: z.string(),
  originalThesis: z.string(),
  confidence: z.number().min(0).max(100),
  evidenceUsed: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  expectedOutcome: z.string(),
  actualOutcome: z.string().nullable(),
  timeHorizon: z.string(),
  agent: agentNameSchema,
  strategyDowngraded: z.boolean().default(false),
  createdAt: z.string(),
});

export const predictionReviewSubmissionSchema = z.object({
  predictionId: z.string().min(1),
  actualOutcome: z.string().min(3),
  missingEvidence: z.array(z.string()).default([]),
  agent: agentNameSchema.optional(),
});

export const predictionReviewSchema = z.object({
  id: z.string(),
  predictionId: z.string(),
  originalThesis: z.string(),
  confidence: z.number().min(0).max(100),
  evidenceUsed: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  expectedOutcome: z.string(),
  actualOutcome: z.string(),
  timeHorizon: z.string(),
  whatWasWrong: z.array(z.string()),
  whatWasMissed: z.array(z.string()),
  whichAgentFailed: agentNameSchema,
  updatedLesson: z.string(),
  futureRuleAdjustment: z.string(),
  shouldConfidenceModelChange: z.boolean(),
  shouldStrategyBeDowngraded: z.boolean(),
  userLearning: z.string(),
  feeds: z.object({
    knowledgeGraph: z.array(z.string()),
    proficiencyGraph: z.array(z.string()),
    behavioralIntelligence: z.array(z.string()),
    agentEvaluation: z.array(z.string()),
    researchQualityScores: z.array(z.string()),
  }),
  reviewedAt: z.string(),
});

export const marketPilotOverviewSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    liveTradingEnabled: z.boolean(),
    paperTradingEnabled: z.boolean(),
  }),
  progression: progressionSchema,
  proficiencyScores: z.array(proficiencyScoreSchema),
  modules: z.array(learningModuleSchema),
  researchReports: z.array(researchReportSchema),
  riskRules: z.array(riskRuleSchema),
  riskSettings: riskSettingsSchema,
  complianceProfile: complianceProfileSchema,
  portfolio: paperPortfolioSchema,
  tradeTickets: z.array(tradeTicketSchema),
  journalEntries: z.array(journalEntrySchema),
  auditLogs: z.array(auditLogSchema),
});

export type LearningStage = z.infer<typeof learningStageSchema>;
export type UnlockStatus = z.infer<typeof unlockStatusSchema>;
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type RiskDecision = z.infer<typeof riskDecisionSchema>;
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type LearningModule = z.infer<typeof learningModuleSchema>;
export type ProficiencyScore = z.infer<typeof proficiencyScoreSchema>;
export type Progression = z.infer<typeof progressionSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type VerificationQualityReport = z.infer<typeof verificationQualityReportSchema>;
export type ResearchReport = z.infer<typeof researchReportSchema>;
export type MarketMovementExplanation = z.infer<typeof marketMovementExplanationSchema>;
export type AgentName = z.infer<typeof agentNameSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export type SupervisorWorkflowStep = z.infer<typeof supervisorWorkflowStepSchema>;
export type SupervisorTicketReview = z.infer<typeof supervisorTicketReviewSchema>;
export type SupervisorReport = z.infer<typeof supervisorReportSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type MarketPrice = z.infer<typeof marketPriceSchema>;
export type EconomicEvent = z.infer<typeof economicEventSchema>;
export type NewsArticle = z.infer<typeof newsArticleSchema>;
export type IngestionSnapshot = z.infer<typeof ingestionSnapshotSchema>;
export type ScheduledMarketBriefing = z.infer<typeof scheduledMarketBriefingSchema>;
export type RiskRule = z.infer<typeof riskRuleSchema>;
export type RiskSettings = z.infer<typeof riskSettingsSchema>;
export type RiskSettingsUpdate = z.infer<typeof riskSettingsUpdateSchema>;
export type RiskCheck = z.infer<typeof riskCheckSchema>;
export type PaperPortfolio = z.infer<typeof paperPortfolioSchema>;
export type PortfolioRiskAnalytics = z.infer<typeof portfolioRiskAnalyticsSchema>;
export type TradeTicket = z.infer<typeof tradeTicketSchema>;
export type TradeTicketProposal = z.infer<typeof tradeTicketProposalSchema>;
export type QuizResult = z.infer<typeof quizResultSchema>;
export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;
export type ProficiencyAssessmentResult = z.infer<typeof proficiencyAssessmentResultSchema>;
export type PaperTradeFillRequest = z.infer<typeof paperTradeFillRequestSchema>;
export type PaperTradeCloseRequest = z.infer<typeof paperTradeCloseRequestSchema>;
export type PaperTradeCloseResult = z.infer<typeof paperTradeCloseResultSchema>;
export type OptionLeg = z.infer<typeof optionLegSchema>;
export type OptionsSimulationRequest = z.infer<typeof optionsSimulationRequestSchema>;
export type OptionsSimulation = z.infer<typeof optionsSimulationSchema>;
export type BacktestAllocation = z.infer<typeof backtestAllocationSchema>;
export type BacktestRequest = z.infer<typeof backtestRequestSchema>;
export type BacktestResult = z.infer<typeof backtestResultSchema>;
export type OrderPreview = z.infer<typeof orderPreviewSchema>;
export type BrokerReadinessCheck = z.infer<typeof brokerReadinessCheckSchema>;
export type BrokerReadiness = z.infer<typeof brokerReadinessSchema>;
export type LiveAssistancePolicy = z.infer<typeof liveAssistancePolicySchema>;
export type SecurityControl = z.infer<typeof securityControlSchema>;
export type SecurityPostureReport = z.infer<typeof securityPostureReportSchema>;
export type MarketPilotEvent = z.infer<typeof marketPilotEventSchema>;
export type EventLogSnapshot = z.infer<typeof eventLogSnapshotSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ProviderHealth = z.infer<typeof providerHealthSchema>;
export type ProviderRegistrySnapshot = z.infer<typeof providerRegistrySnapshotSchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type HistoricalAnalogue = z.infer<typeof historicalAnalogueSchema>;
export type MemoryHealth = z.infer<typeof memoryHealthSchema>;
export type StorageHealth = z.infer<typeof storageHealthSchema>;
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;
export type KnowledgeGraphNode = z.infer<typeof knowledgeGraphNodeSchema>;
export type KnowledgeGraphEdge = z.infer<typeof knowledgeGraphEdgeSchema>;
export type KnowledgeGraphReport = z.infer<typeof knowledgeGraphReportSchema>;
export type CrossAssetRelationshipReport = z.infer<typeof crossAssetRelationshipReportSchema>;
export type FactorExposureReport = z.infer<typeof factorExposureReportSchema>;
export type MonteCarloSimulationReport = z.infer<typeof monteCarloSimulationReportSchema>;
export type StressTestReport = z.infer<typeof stressTestReportSchema>;
export type GreeksReport = z.infer<typeof greeksReportSchema>;
export type RegimeReport = z.infer<typeof regimeReportSchema>;
export type AgentConsensusReport = z.infer<typeof agentConsensusReportSchema>;
export type BehavioralIntelligenceReport = z.infer<typeof behavioralIntelligenceReportSchema>;
export type ProficiencyGraphReport = z.infer<typeof proficiencyGraphReportSchema>;
export type InstitutionalAnalyticsSnapshot = z.infer<typeof institutionalAnalyticsSnapshotSchema>;
export type ComplianceProfile = z.infer<typeof complianceProfileSchema>;
export type ComplianceAcknowledgementSubmission = z.infer<typeof complianceAcknowledgementSubmissionSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalReview = z.infer<typeof journalReviewSchema>;
export type JournalReviewSubmission = z.infer<typeof journalReviewSubmissionSchema>;
export type JournalReviewResult = z.infer<typeof journalReviewResultSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
export type ComplianceAuditEvent = z.infer<typeof complianceAuditEventSchema>;
export type ComplianceAuditSummary = z.infer<typeof complianceAuditSummarySchema>;
export type EvaluationMetric = z.infer<typeof evaluationMetricSchema>;
export type EvaluationSuite = z.infer<typeof evaluationSuiteSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type AssistantDomain = z.infer<typeof assistantDomainSchema>;
export type DecisionCard = z.infer<typeof decisionCardSchema>;
export type SignalPriorityInput = z.infer<typeof signalPriorityInputSchema>;
export type PrioritizedSignal = z.infer<typeof prioritizedSignalSchema>;
export type StrategySuggestion = z.infer<typeof strategySuggestionSchema>;
export type MarketMoveInvestigation = z.infer<typeof marketMoveInvestigationSchema>;
export type TradingAssistantIntent = z.infer<typeof tradingAssistantIntentSchema>;
export type TradingAssistantIntentClassification = z.infer<typeof tradingAssistantIntentClassificationSchema>;
export type TradingAssistantRequest = z.infer<typeof tradingAssistantRequestSchema>;
export type TradingAssistantResponse = z.infer<typeof tradingAssistantResponseSchema>;
export type PredictionRecord = z.infer<typeof predictionRecordSchema>;
export type PredictionReviewSubmission = z.infer<typeof predictionReviewSubmissionSchema>;
export type PredictionReview = z.infer<typeof predictionReviewSchema>;
export type MarketPilotOverview = z.infer<typeof marketPilotOverviewSchema>;
