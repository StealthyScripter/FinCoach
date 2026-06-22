import {
  auditLogs,
  complianceAcknowledgementSubmissionSchema,
  type ComplianceAcknowledgementSubmission,
  type ComplianceProfile,
  complianceProfiles,
  aiEvaluations,
  ingestionRuns,
  type AuditLog,
  holdings,
  type InsertUser,
  type JournalEntry,
  journalEntries,
  journalReviews,
  type JournalReview,
  type JournalReviewResult,
  type JournalReviewSubmission,
  learningModules,
  type LearningModule,
  type MarketPilotOverview,
  ragDocuments,
  ragRuns,
  orderPreviews,
  type OrderPreview,
  type PaperTradeFillRequest,
  type PaperTradeCloseRequest,
  type PaperTradeCloseResult,
  paperPortfolios,
  type PaperPortfolio,
  type ProficiencyAssessmentResult,
  type ProficiencyScore,
  proficiencyScores,
  type Progression,
  quizResults,
  type QuizSubmission,
  researchReports,
  type ResearchReport,
  riskChecks,
  riskRules,
  type RiskRule,
  riskSettings,
  riskSettingsSchema,
  type RiskSettings,
  type RiskSettingsUpdate,
  type TradeTicket,
  type TradeTicketProposal,
  tradeTickets,
  type User,
  users,
  verificationChecks,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { evaluateTradeTicketRisk } from "./riskEngine";
import { createDatabase, type AppDatabase } from "./db";
import { eventCalendarService } from "./eventCalendarService";
import { brokerPreviewService } from "./brokerPreviewService";
import { deriveProgression, proficiencyAssessmentService } from "./proficiencyAssessmentService";
import { journalReviewService } from "./journalReviewService";
import { getStorageMode, validateDatabaseUrl } from "./storageMode";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getMarketPilotOverview(): Promise<MarketPilotOverview>;
  getLearningModules(): Promise<LearningModule[]>;
  getResearchReports(): Promise<ResearchReport[]>;
  saveResearchReport(report: ResearchReport): Promise<ResearchReport>;
  getRiskRules(): Promise<RiskRule[]>;
  getRiskSettings(): Promise<RiskSettings>;
  updateRiskSettings(settings: RiskSettingsUpdate): Promise<RiskSettings>;
  getComplianceProfile(): Promise<ComplianceProfile>;
  acknowledgeCompliance(submission: ComplianceAcknowledgementSubmission): Promise<ComplianceProfile>;
  getPaperPortfolio(): Promise<PaperPortfolio>;
  getTradeTickets(): Promise<TradeTicket[]>;
  createTradeTicket(proposal: TradeTicketProposal): Promise<TradeTicket>;
  createOrderPreview(ticketId: string): Promise<OrderPreview>;
  fillPaperTrade(ticketId: string, acknowledgement: PaperTradeFillRequest): Promise<{ ticket: TradeTicket; journalEntry: JournalEntry }>;
  closePaperTrade(ticketId: string, closeRequest: PaperTradeCloseRequest): Promise<PaperTradeCloseResult>;
  submitQuizResult(submission: QuizSubmission): Promise<ProficiencyAssessmentResult>;
  submitJournalReview(submission: JournalReviewSubmission): Promise<JournalReviewResult>;
  getJournalEntries(): Promise<JournalEntry[]>;
  getJournalReviews(): Promise<JournalReview[]>;
  getRagRuns(): Promise<RagRun[]>;
  saveRagRun(run: RagRun): Promise<RagRun>;
  getRagDocuments(): Promise<RagDocument[]>;
  saveRagDocuments(documents: RagDocument[]): Promise<RagDocument[]>;
  getAiEvaluations(): Promise<AIEvaluationRecord[]>;
  saveAiEvaluation(record: AIEvaluationRecord): Promise<AIEvaluationRecord>;
  getIngestionRuns(): Promise<IngestionRunRecord[]>;
  saveIngestionRun(record: IngestionRunRecord): Promise<IngestionRunRecord>;
}

export type RagRun = {
  id: string;
  userId: string;
  query: string;
  chunkCount: number;
  confidence: number;
  sourceFreshness: "fresh" | "stale" | "mixed";
  citationIds: string[];
  chunkIds: string[];
  createdAt: string;
};

export type RagDocument = {
  id: string;
  userId: string;
  runId: string;
  kind: string;
  text: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  chunkIds: string[];
  createdAt: string;
};

export type AIEvaluationRecord = {
  id: string;
  userId: string;
  artifactId: string;
  artifactType: string;
  promptVersion: string;
  outputSummary: string;
  overallScore: number;
  requiredActions: string[];
  generatedAt: string;
};

export type IngestionRunRecord = {
  id: string;
  userId: string;
  providerId: string;
  status: "success" | "partial" | "failed" | "dry_run";
  startedAt: string;
  completedAt: string;
  records: number;
  freshness: { newestTimestamp: string | null; oldestTimestamp: string | null };
  errors: string[];
};

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private overview: MarketPilotOverview;
  private orderPreviews: Map<string, OrderPreview>;
  private ragRunRecords: RagRun[];
  private ragDocumentRecords: RagDocument[];
  private aiEvaluationRecords: AIEvaluationRecord[];
  private ingestionRunRecords: IngestionRunRecord[];
  private journalReviewRecords: JournalReview[];

  constructor() {
    this.users = new Map();
    this.overview = createSeedOverview();
    this.orderPreviews = new Map();
    this.ragRunRecords = [];
    this.ragDocumentRecords = [];
    this.aiEvaluationRecords = [];
    this.ingestionRunRecords = [];
    this.journalReviewRecords = [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getMarketPilotOverview(): Promise<MarketPilotOverview> {
    return this.overview;
  }

  async getLearningModules(): Promise<LearningModule[]> {
    return this.overview.modules;
  }

  async getResearchReports(): Promise<ResearchReport[]> {
    return this.overview.researchReports;
  }

  async saveResearchReport(report: ResearchReport): Promise<ResearchReport> {
    this.overview.researchReports = [report, ...this.overview.researchReports.filter((item) => item.id !== report.id)];
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: report.agent,
        action: "generated_research_report",
        target: report.id,
        metadata: { confidence: report.confidence, asset: report.asset ?? null },
        createdAt: new Date().toISOString(),
      },
      ...this.overview.auditLogs,
    ];
    return report;
  }

  async getRiskRules(): Promise<RiskRule[]> {
    return this.overview.riskRules;
  }

  async getRiskSettings(): Promise<RiskSettings> {
    return this.overview.riskSettings;
  }

  async updateRiskSettings(settings: RiskSettingsUpdate): Promise<RiskSettings> {
    const now = new Date().toISOString();
    this.overview.riskSettings = {
      ...this.overview.riskSettings,
      ...settings,
      updatedAt: now,
    };
    this.overview.riskSettings = riskSettingsSchema.parse(this.overview.riskSettings);
    this.overview.riskRules = riskRulesFromSettings(this.overview.riskSettings);
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "risk_officer",
        action: "updated_risk_settings",
        target: this.overview.riskSettings.id,
        metadata: settings,
        createdAt: now,
      },
      ...this.overview.auditLogs,
    ];
    return this.overview.riskSettings;
  }

  async getComplianceProfile(): Promise<ComplianceProfile> {
    return this.overview.complianceProfile;
  }

  async acknowledgeCompliance(submission: ComplianceAcknowledgementSubmission): Promise<ComplianceProfile> {
    const parsed = complianceAcknowledgementSubmissionSchema.parse(submission);
    const now = new Date().toISOString();
    this.overview.complianceProfile = {
      ...this.overview.complianceProfile,
      disclosuresAccepted: true,
      disclosureVersion: parsed.disclosureVersion,
      acceptedAt: now,
      userConfirmation: parsed.userConfirmation,
      updatedAt: now,
    };
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "user",
        action: "acknowledged_compliance_disclosures",
        target: this.overview.user.id,
        metadata: {
          disclosureVersion: parsed.disclosureVersion,
          userConfirmation: parsed.userConfirmation,
        },
        createdAt: now,
      },
      ...this.overview.auditLogs,
    ];
    return this.overview.complianceProfile;
  }

  async getPaperPortfolio(): Promise<PaperPortfolio> {
    return this.overview.portfolio;
  }

  async getTradeTickets(): Promise<TradeTicket[]> {
    return this.overview.tradeTickets;
  }

  async createTradeTicket(proposal: TradeTicketProposal): Promise<TradeTicket> {
    const now = new Date().toISOString();
    const evaluation = evaluateTradeTicketRisk({
      proposal,
      portfolioValue: this.overview.portfolio.totalValue,
      liveTradingEnabled: this.overview.user.liveTradingEnabled,
      proficiencyScores: this.overview.proficiencyScores,
      eventRisks: eventCalendarService.getBlockingEvents(proposal.asset, new Date(now)),
      behavioralRisk: getBehavioralRiskSignal(this.overview),
      checkedAt: now,
      riskSettings: this.overview.riskSettings,
    });

    const ticket: TradeTicket = {
      id: randomUUID(),
      ...proposal,
      riskAmount: evaluation.riskAmount,
      portfolioImpact: evaluation.portfolioImpact,
      alternativeChoices: proposal.alternativeChoices,
      confidence: evaluation.confidence,
      status: evaluation.status,
      verification: {
        id: randomUUID(),
        status: "requires_human_review",
        confidence: 50,
        evidenceSummary:
          "User-submitted tickets require market data and source verification before paper approval.",
        contradictoryEvidence: ["No external market data provider is connected in the current MVP."],
        whatWouldDisprove:
          "Fresh market data, news, or portfolio changes may invalidate the submitted rationale.",
        sources: [
          {
            name: "User supplied rationale",
            timestamp: now,
            reliability: "low",
          },
        ],
      },
      riskCheck: evaluation.riskCheck,
      createdAt: now,
    };

    this.overview.tradeTickets = [ticket, ...this.overview.tradeTickets];
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "risk_officer",
        action: `evaluated_ticket_${evaluation.riskCheck.decision}`,
        target: ticket.id,
        metadata: {
          decision: evaluation.riskCheck.decision,
          score: evaluation.riskCheck.score,
          riskAmount: evaluation.riskAmount,
          confidence: evaluation.confidence,
        },
        createdAt: now,
      },
      ...this.overview.auditLogs,
    ];

    return ticket;
  }

  async createOrderPreview(ticketId: string): Promise<OrderPreview> {
    const ticket = this.overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    const preview = brokerPreviewService.createOrderPreview({
      ticket,
      overview: this.overview,
    });
    this.orderPreviews.set(ticket.id, preview);
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "paper_broker",
        action: "generated_order_preview",
        target: ticket.id,
        metadata: {
          previewId: preview.id,
          estimatedTotalCost: preview.estimatedTotalCost,
          liquidityCheck: preview.liquidityCheck,
        },
        createdAt: preview.createdAt,
      },
      ...this.overview.auditLogs,
    ];

    return preview;
  }

  async fillPaperTrade(ticketId: string, acknowledgement: PaperTradeFillRequest): Promise<{ ticket: TradeTicket; journalEntry: JournalEntry }> {
    const ticket = this.overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    if (ticket.riskCheck.decision !== "approve" || ticket.status !== "proposed") {
      throw Object.assign(new Error("Only risk-approved proposed tickets can be paper filled"), {
        status: 409,
      });
    }

    const preview = this.orderPreviews.get(ticket.id);

    if (!preview) {
      throw Object.assign(new Error("Paper fill requires an order preview first"), {
        status: 409,
      });
    }

    if (acknowledgement.previewId && acknowledgement.previewId !== preview.id) {
      throw Object.assign(new Error("Paper fill acknowledgement does not match the order preview"), {
        status: 409,
      });
    }

    if (!acknowledgement.complianceAcknowledged) {
      throw Object.assign(new Error("Paper fill requires compliance acknowledgement"), {
        status: 409,
      });
    }

    const now = new Date().toISOString();
    const filledTicket: TradeTicket = {
      ...ticket,
      status: "paper_filled",
    };
    const journalEntry: JournalEntry = {
      id: randomUUID(),
      title: `Paper fill: ${ticket.direction.toUpperCase()} ${ticket.asset}`,
      linkedTicketId: ticket.id,
      qualityScore: 65,
      notes:
        "Automatic journal entry created from a risk-approved paper fill. User should add post-trade reflection before this contributes to proficiency.",
      lessons: [
        "Paper fill required risk approval",
        "Live execution remained locked",
        "Follow exit criteria and invalidation condition",
      ],
      createdAt: now,
    };

    this.overview.tradeTickets = this.overview.tradeTickets.map((item) =>
      item.id === ticketId ? filledTicket : item,
    );
    this.overview.journalEntries = [journalEntry, ...this.overview.journalEntries];
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "paper_broker",
        action: "paper_filled_ticket",
        target: ticket.id,
        metadata: {
          previewId: preview.id,
          journalEntryId: journalEntry.id,
        },
        createdAt: now,
      },
      {
        id: randomUUID(),
        actor: "user",
        action: "acknowledged_paper_fill_compliance",
        target: ticket.id,
        metadata: {
          previewId: preview.id,
          userConfirmation: acknowledgement.userConfirmation,
        },
        createdAt: now,
      },
      ...this.overview.auditLogs,
    ];

    return { ticket: filledTicket, journalEntry };
  }

  async closePaperTrade(ticketId: string, closeRequest: PaperTradeCloseRequest): Promise<PaperTradeCloseResult> {
    const ticket = this.overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    if (ticket.status !== "paper_filled") {
      throw Object.assign(new Error("Only paper-filled tickets can be closed"), { status: 409 });
    }

    const now = new Date().toISOString();
    const { realizedPnl, returnPct } = calculatePaperPnl(ticket, closeRequest.exitPrice);
    const closedTicket: TradeTicket = { ...ticket, status: "closed" };
    const journalEntry: JournalEntry = {
      id: randomUUID(),
      title: `Paper close: ${ticket.direction.toUpperCase()} ${ticket.asset}`,
      linkedTicketId: ticket.id,
      qualityScore: closeRequest.followedExitCriteria ? 78 : 52,
      notes:
        `Closed paper ticket at $${closeRequest.exitPrice.toFixed(2)} for ${realizedPnl >= 0 ? "gain" : "loss"} of $${realizedPnl.toFixed(2)}. Exit reason: ${closeRequest.exitReason}`,
      lessons: [
        closeRequest.followedExitCriteria ? "Exit criteria followed" : "Exit criteria was not fully followed",
        ...closeRequest.lessonsLearned,
      ],
      createdAt: now,
    };

    this.overview.tradeTickets = this.overview.tradeTickets.map((item) =>
      item.id === ticketId ? closedTicket : item,
    );
    this.overview.journalEntries = [journalEntry, ...this.overview.journalEntries];
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "paper_broker",
        action: "paper_closed_ticket",
        target: ticket.id,
        metadata: {
          exitPrice: closeRequest.exitPrice,
          realizedPnl,
          returnPct,
          followedExitCriteria: closeRequest.followedExitCriteria,
          journalEntryId: journalEntry.id,
        },
        createdAt: now,
      },
      ...this.overview.auditLogs,
    ];

    return { ticket: closedTicket, journalEntry, realizedPnl, returnPct };
  }

  async submitQuizResult(submission: QuizSubmission): Promise<ProficiencyAssessmentResult> {
    const assessment = proficiencyAssessmentService.assess({
      submission,
      scores: this.overview.proficiencyScores,
      modules: this.overview.modules,
      progression: this.overview.progression,
    });

    this.overview.proficiencyScores = this.overview.proficiencyScores.map((score) =>
      score.category === assessment.updatedScore.category ? assessment.updatedScore : score,
    );
    this.overview.modules = this.overview.modules.map((module) =>
      module.id === assessment.module.id ? assessment.module : module,
    );
    this.overview.progression = assessment.progression;
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "assessment_engine",
        action: assessment.passed ? "recorded_passing_quiz_result" : "recorded_remediation_quiz_result",
        target: assessment.quizResult.id,
        metadata: {
          moduleId: assessment.quizResult.moduleId,
          category: assessment.quizResult.category,
          score: assessment.quizResult.score,
          proficiencyDelta: assessment.proficiencyDelta,
          updatedScore: assessment.updatedScore.score,
        },
        createdAt: assessment.quizResult.createdAt,
      },
      ...this.overview.auditLogs,
    ];

    return assessment;
  }

  async submitJournalReview(submission: JournalReviewSubmission): Promise<JournalReviewResult> {
    const journalEntry = this.overview.journalEntries.find((entry) => entry.id === submission.journalEntryId);

    if (!journalEntry) {
      throw Object.assign(new Error("Journal entry not found"), { status: 404 });
    }

    const review = journalReviewService.review({
      submission,
      journalEntry,
      scores: this.overview.proficiencyScores,
      progression: this.overview.progression,
    });

    this.overview.journalEntries = this.overview.journalEntries.map((entry) =>
      entry.id === review.journalEntry.id ? review.journalEntry : entry,
    );
    this.overview.proficiencyScores = upsertScore(this.overview.proficiencyScores, review.updatedScore);
    this.overview.progression = review.progression;
    this.overview.auditLogs = [
      {
        id: randomUUID(),
        actor: "journal_reviewer",
        action: "reviewed_journal_entry",
        target: review.journalEntry.id,
        metadata: {
          reviewId: review.review.id,
          qualityScore: review.review.qualityScore,
          proficiencyDelta: review.review.proficiencyDelta,
          mistakePatterns: review.review.mistakePatterns,
        },
        createdAt: review.review.createdAt,
      },
      ...this.overview.auditLogs,
    ];
    this.journalReviewRecords = [review.review, ...this.journalReviewRecords.filter((item) => item.id !== review.review.id)];

    return review;
  }

  async getJournalEntries(): Promise<JournalEntry[]> {
    return this.overview.journalEntries;
  }

  async getJournalReviews(): Promise<JournalReview[]> {
    return [...this.journalReviewRecords];
  }

  async getRagRuns(): Promise<RagRun[]> {
    return [...this.ragRunRecords];
  }

  async saveRagRun(run: RagRun): Promise<RagRun> {
    this.ragRunRecords = [run, ...this.ragRunRecords.filter((item) => item.id !== run.id)];
    return run;
  }

  async getRagDocuments(): Promise<RagDocument[]> {
    return [...this.ragDocumentRecords];
  }

  async saveRagDocuments(documents: RagDocument[]): Promise<RagDocument[]> {
    for (const document of documents) {
      this.ragDocumentRecords = [document, ...this.ragDocumentRecords.filter((item) => item.id !== document.id)];
    }
    return documents;
  }

  async getAiEvaluations(): Promise<AIEvaluationRecord[]> {
    return [...this.aiEvaluationRecords];
  }

  async saveAiEvaluation(record: AIEvaluationRecord): Promise<AIEvaluationRecord> {
    this.aiEvaluationRecords = [record, ...this.aiEvaluationRecords.filter((item) => item.id !== record.id)];
    return record;
  }

  async getIngestionRuns(): Promise<IngestionRunRecord[]> {
    return [...this.ingestionRunRecords];
  }

  async saveIngestionRun(record: IngestionRunRecord): Promise<IngestionRunRecord> {
    this.ingestionRunRecords = [record, ...this.ingestionRunRecords.filter((item) => item.id !== record.id)];
    return record;
  }
}

export class PgStorage implements IStorage {
  private seeded = false;

  constructor(private readonly db: AppDatabase) {}

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await this.db.insert(users).values(insertUser).returning();
    return user;
  }

  async getMarketPilotOverview(): Promise<MarketPilotOverview> {
    await this.ensureSeeded();
    return this.loadOverview();
  }

  async getLearningModules(): Promise<LearningModule[]> {
    return (await this.getMarketPilotOverview()).modules;
  }

  async getResearchReports(): Promise<ResearchReport[]> {
    return (await this.getMarketPilotOverview()).researchReports;
  }

  async saveResearchReport(report: ResearchReport): Promise<ResearchReport> {
    await this.ensureSeeded();
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx.insert(verificationChecks).values(toVerificationRow(report.verification)).onConflictDoNothing();
      await tx.insert(researchReports).values({
        id: report.id,
        verificationCheckId: report.verification.id,
        agent: report.agent,
        title: report.title,
        asset: report.asset,
        summary: report.summary,
        mainCause: report.mainCause,
        secondaryCauses: report.secondaryCauses,
        riskFactors: report.riskFactors,
        classification: report.classification,
        confidence: report.confidence,
        generatedAt: new Date(report.generatedAt),
      }).onConflictDoNothing();
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: report.agent,
        action: "generated_research_report",
        target: report.id,
        metadata: { asset: report.asset ?? null, confidence: report.confidence },
        createdAt: now,
      });
    });

    return report;
  }

  async getRiskRules(): Promise<RiskRule[]> {
    return (await this.getMarketPilotOverview()).riskRules;
  }

  async getRiskSettings(): Promise<RiskSettings> {
    return (await this.getMarketPilotOverview()).riskSettings;
  }

  async updateRiskSettings(settings: RiskSettingsUpdate): Promise<RiskSettings> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const now = new Date();
    const nextSettings: RiskSettings = {
      ...overview.riskSettings,
      ...settings,
      updatedAt: now.toISOString(),
    };
    riskSettingsSchema.parse(nextSettings);
    const nextRules = riskRulesFromSettings(nextSettings);

    await this.db.transaction(async (tx) => {
      await tx.update(riskSettings)
        .set({
          maxRiskPerTradePct: nextSettings.maxRiskPerTradePct,
          reduceSizeAbovePct: nextSettings.reduceSizeAbovePct,
          maxDailyLossPct: nextSettings.maxDailyLossPct,
          maxWeeklyLossPct: nextSettings.maxWeeklyLossPct,
          maxSinglePositionPct: nextSettings.maxSinglePositionPct,
          maxOptionsPremiumPct: nextSettings.maxOptionsPremiumPct,
          noTradeBeforeHighImpactEventHours: nextSettings.noTradeBeforeHighImpactEventHours,
          updatedAt: now,
        })
        .where(eq(riskSettings.id, nextSettings.id));

      for (const rule of nextRules) {
        await tx.update(riskRules)
          .set({
            limit: rule.limit,
            status: rule.status,
            description: rule.description,
          })
          .where(eq(riskRules.id, rule.id));
      }

      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "risk_officer",
        action: "updated_risk_settings",
        target: nextSettings.id,
        metadata: settings,
        createdAt: now,
      });
    });

    return nextSettings;
  }

  async getComplianceProfile(): Promise<ComplianceProfile> {
    return (await this.getMarketPilotOverview()).complianceProfile;
  }

  async acknowledgeCompliance(submission: ComplianceAcknowledgementSubmission): Promise<ComplianceProfile> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const parsed = complianceAcknowledgementSubmissionSchema.parse(submission);
    const now = new Date();
    const profile: ComplianceProfile = {
      ...overview.complianceProfile,
      disclosuresAccepted: true,
      disclosureVersion: parsed.disclosureVersion,
      acceptedAt: now.toISOString(),
      userConfirmation: parsed.userConfirmation,
      updatedAt: now.toISOString(),
    };

    await this.db.transaction(async (tx) => {
      await tx.update(complianceProfiles)
        .set({
          disclosuresAccepted: profile.disclosuresAccepted,
          disclosureVersion: profile.disclosureVersion,
          acceptedAt: now,
          userConfirmation: profile.userConfirmation,
          updatedAt: now,
        })
        .where(eq(complianceProfiles.id, profile.id));
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "user",
        action: "acknowledged_compliance_disclosures",
        target: overview.user.id,
        metadata: {
          disclosureVersion: parsed.disclosureVersion,
          userConfirmation: parsed.userConfirmation,
        },
        createdAt: now,
      });
    });

    return profile;
  }

  async getPaperPortfolio(): Promise<PaperPortfolio> {
    return (await this.getMarketPilotOverview()).portfolio;
  }

  async getTradeTickets(): Promise<TradeTicket[]> {
    return (await this.getMarketPilotOverview()).tradeTickets;
  }

  async createTradeTicket(proposal: TradeTicketProposal): Promise<TradeTicket> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const now = new Date().toISOString();
    const evaluation = evaluateTradeTicketRisk({
      proposal,
      portfolioValue: overview.portfolio.totalValue,
      liveTradingEnabled: overview.user.liveTradingEnabled,
      proficiencyScores: overview.proficiencyScores,
      eventRisks: eventCalendarService.getBlockingEvents(proposal.asset, new Date(now)),
      behavioralRisk: getBehavioralRiskSignal(overview),
      checkedAt: now,
      riskSettings: overview.riskSettings,
    });
    const verification = {
      id: randomUUID(),
      status: "requires_human_review" as const,
      confidence: 50,
      evidenceSummary:
        "User-submitted tickets require market data and source verification before paper approval.",
      contradictoryEvidence: ["No external market data provider is connected in the current MVP."],
      whatWouldDisprove:
        "Fresh market data, news, or portfolio changes may invalidate the submitted rationale.",
      sources: [
        {
          name: "User supplied rationale",
          timestamp: now,
          reliability: "low" as const,
        },
      ],
    };
    const ticket: TradeTicket = {
      id: randomUUID(),
      ...proposal,
      riskAmount: evaluation.riskAmount,
      portfolioImpact: evaluation.portfolioImpact,
      alternativeChoices: proposal.alternativeChoices,
      confidence: evaluation.confidence,
      status: evaluation.status,
      verification,
      riskCheck: evaluation.riskCheck,
      createdAt: now,
    };

    await this.db.transaction(async (tx) => {
      await tx.insert(verificationChecks).values(toVerificationRow(verification));
      await tx.insert(riskChecks).values({
        id: ticket.riskCheck.id,
        tradeTicketId: ticket.id,
        decision: ticket.riskCheck.decision,
        score: ticket.riskCheck.score,
        reasons: ticket.riskCheck.reasons,
        requiredActions: ticket.riskCheck.requiredActions,
        checkedAt: new Date(ticket.riskCheck.checkedAt),
      });
      await tx.insert(tradeTickets).values(toTradeTicketRow(ticket, overview.user.id));
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "risk_officer",
        action: `evaluated_ticket_${evaluation.riskCheck.decision}`,
        target: ticket.id,
        metadata: {},
        createdAt: new Date(now),
      });
    });

    return ticket;
  }

  async createOrderPreview(ticketId: string): Promise<OrderPreview> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const ticket = overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    const preview = brokerPreviewService.createOrderPreview({ ticket, overview });

    await this.db.transaction(async (tx) => {
      await tx.insert(orderPreviews).values({
        id: preview.id,
        tradeTicketId: preview.tradeTicketId,
        userId: overview.user.id,
        broker: preview.broker,
        environment: preview.environment,
        estimatedNotional: preview.estimatedNotional,
        estimatedFees: preview.estimatedFees,
        estimatedSlippage: preview.estimatedSlippage,
        estimatedTotalCost: preview.estimatedTotalCost,
        buyingPowerImpact: preview.buyingPowerImpact,
        marginRequirement: preview.marginRequirement,
        liquidityCheck: preview.liquidityCheck,
        liveExecutionBlocked: preview.liveExecutionBlocked,
        complianceAcknowledgementRequired: preview.complianceAcknowledgementRequired,
        warnings: preview.warnings,
        approvalSteps: preview.approvalSteps,
        createdAt: new Date(preview.createdAt),
      });
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "paper_broker",
        action: "generated_order_preview",
        target: ticket.id,
        metadata: {
          previewId: preview.id,
          estimatedTotalCost: preview.estimatedTotalCost,
          liquidityCheck: preview.liquidityCheck,
        },
        createdAt: new Date(preview.createdAt),
      });
    });

    return preview;
  }

  async fillPaperTrade(ticketId: string, acknowledgement: PaperTradeFillRequest): Promise<{ ticket: TradeTicket; journalEntry: JournalEntry }> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const ticket = overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    if (ticket.riskCheck.decision !== "approve" || ticket.status !== "proposed") {
      throw Object.assign(new Error("Only risk-approved proposed tickets can be paper filled"), {
        status: 409,
      });
    }

    const existingPreview = await this.db.select({ id: orderPreviews.id })
      .from(orderPreviews)
      .where(eq(orderPreviews.tradeTicketId, ticket.id))
      .limit(1);

    if (existingPreview.length === 0) {
      throw Object.assign(new Error("Paper fill requires an order preview first"), {
        status: 409,
      });
    }

    if (acknowledgement.previewId && acknowledgement.previewId !== existingPreview[0].id) {
      throw Object.assign(new Error("Paper fill acknowledgement does not match the order preview"), {
        status: 409,
      });
    }

    if (!acknowledgement.complianceAcknowledged) {
      throw Object.assign(new Error("Paper fill requires compliance acknowledgement"), {
        status: 409,
      });
    }

    const now = new Date().toISOString();
    const filledTicket: TradeTicket = { ...ticket, status: "paper_filled" };
    const journalEntry: JournalEntry = {
      id: randomUUID(),
      title: `Paper fill: ${ticket.direction.toUpperCase()} ${ticket.asset}`,
      linkedTicketId: ticket.id,
      qualityScore: 65,
      notes:
        "Automatic journal entry created from a risk-approved paper fill. User should add post-trade reflection before this contributes to proficiency.",
      lessons: [
        "Paper fill required risk approval",
        "Live execution remained locked",
        "Follow exit criteria and invalidation condition",
      ],
      createdAt: now,
    };

    await this.db.transaction(async (tx) => {
      await tx.update(tradeTickets).set({ status: "paper_filled" }).where(eq(tradeTickets.id, ticket.id));
      await tx.insert(journalEntries).values({
        id: journalEntry.id,
        userId: overview.user.id,
        linkedTicketId: journalEntry.linkedTicketId,
        title: journalEntry.title,
        qualityScore: journalEntry.qualityScore,
        notes: journalEntry.notes,
        lessons: journalEntry.lessons,
        createdAt: new Date(journalEntry.createdAt),
      });
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "paper_broker",
        action: "paper_filled_ticket",
        target: ticket.id,
        metadata: {
          previewId: existingPreview[0].id,
        },
        createdAt: new Date(now),
      });
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "user",
        action: "acknowledged_paper_fill_compliance",
        target: ticket.id,
        metadata: {
          previewId: existingPreview[0].id,
          userConfirmation: acknowledgement.userConfirmation,
        },
        createdAt: new Date(now),
      });
    });

    return { ticket: filledTicket, journalEntry };
  }

  async closePaperTrade(ticketId: string, closeRequest: PaperTradeCloseRequest): Promise<PaperTradeCloseResult> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const ticket = overview.tradeTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw Object.assign(new Error("Trade ticket not found"), { status: 404 });
    }

    if (ticket.status !== "paper_filled") {
      throw Object.assign(new Error("Only paper-filled tickets can be closed"), { status: 409 });
    }

    const now = new Date().toISOString();
    const { realizedPnl, returnPct } = calculatePaperPnl(ticket, closeRequest.exitPrice);
    const closedTicket: TradeTicket = { ...ticket, status: "closed" };
    const journalEntry: JournalEntry = {
      id: randomUUID(),
      title: `Paper close: ${ticket.direction.toUpperCase()} ${ticket.asset}`,
      linkedTicketId: ticket.id,
      qualityScore: closeRequest.followedExitCriteria ? 78 : 52,
      notes:
        `Closed paper ticket at $${closeRequest.exitPrice.toFixed(2)} for ${realizedPnl >= 0 ? "gain" : "loss"} of $${realizedPnl.toFixed(2)}. Exit reason: ${closeRequest.exitReason}`,
      lessons: [
        closeRequest.followedExitCriteria ? "Exit criteria followed" : "Exit criteria was not fully followed",
        ...closeRequest.lessonsLearned,
      ],
      createdAt: now,
    };

    await this.db.transaction(async (tx) => {
      await tx.update(tradeTickets).set({ status: "closed" }).where(eq(tradeTickets.id, ticket.id));
      await tx.insert(journalEntries).values({
        id: journalEntry.id,
        userId: overview.user.id,
        linkedTicketId: journalEntry.linkedTicketId,
        title: journalEntry.title,
        qualityScore: journalEntry.qualityScore,
        notes: journalEntry.notes,
        lessons: journalEntry.lessons,
        createdAt: new Date(journalEntry.createdAt),
      });
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "paper_broker",
        action: "paper_closed_ticket",
        target: ticket.id,
        metadata: {
          exitPrice: closeRequest.exitPrice,
          realizedPnl,
          returnPct,
          followedExitCriteria: closeRequest.followedExitCriteria,
          journalEntryId: journalEntry.id,
        },
        createdAt: new Date(now),
      });
    });

    return { ticket: closedTicket, journalEntry, realizedPnl, returnPct };
  }

  async submitQuizResult(submission: QuizSubmission): Promise<ProficiencyAssessmentResult> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const assessment = proficiencyAssessmentService.assess({
      submission,
      scores: overview.proficiencyScores,
      modules: overview.modules,
      progression: overview.progression,
    });

    await this.db.transaction(async (tx) => {
      await tx.insert(quizResults).values({
        id: assessment.quizResult.id,
        userId: overview.user.id,
        moduleId: assessment.quizResult.moduleId,
        category: assessment.quizResult.category,
        score: assessment.quizResult.score,
        passed: assessment.quizResult.passed,
        answers: assessment.quizResult.answers,
        feedback: assessment.quizResult.feedback,
        createdAt: new Date(assessment.quizResult.createdAt),
      });
      await tx.update(proficiencyScores).set({
        score: assessment.updatedScore.score,
        unlocks: assessment.updatedScore.unlocks,
        evidence: assessment.updatedScore.evidence,
        updatedAt: new Date(assessment.updatedScore.updatedAt),
      }).where(eq(proficiencyScores.id, assessment.updatedScore.id));
      await tx.update(learningModules).set({
        progress: assessment.module.progress,
        status: assessment.module.status,
      }).where(eq(learningModules.id, assessment.module.id));
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "assessment_engine",
        action: assessment.passed ? "recorded_passing_quiz_result" : "recorded_remediation_quiz_result",
        target: assessment.quizResult.id,
        metadata: {
          moduleId: assessment.quizResult.moduleId,
          category: assessment.quizResult.category,
          score: assessment.quizResult.score,
          proficiencyDelta: assessment.proficiencyDelta,
          updatedScore: assessment.updatedScore.score,
        },
        createdAt: new Date(assessment.quizResult.createdAt),
      });
    });

    return assessment;
  }

  async submitJournalReview(submission: JournalReviewSubmission): Promise<JournalReviewResult> {
    await this.ensureSeeded();
    const overview = await this.loadOverview();
    const journalEntry = overview.journalEntries.find((entry) => entry.id === submission.journalEntryId);

    if (!journalEntry) {
      throw Object.assign(new Error("Journal entry not found"), { status: 404 });
    }

    const review = journalReviewService.review({
      submission,
      journalEntry,
      scores: overview.proficiencyScores,
      progression: overview.progression,
    });

    await this.db.transaction(async (tx) => {
      await tx.insert(journalReviews).values({
        id: review.review.id,
        userId: overview.user.id,
        journalEntryId: review.review.journalEntryId,
        qualityScore: review.review.qualityScore,
        mistakePatterns: review.review.mistakePatterns,
        disciplineSignals: review.review.disciplineSignals,
        feedback: review.review.feedback,
        proficiencyCategory: review.review.proficiencyCategory,
        proficiencyDelta: review.review.proficiencyDelta,
        createdAt: new Date(review.review.createdAt),
      });
      await tx.update(journalEntries).set({
        qualityScore: review.journalEntry.qualityScore,
        notes: review.journalEntry.notes,
        lessons: review.journalEntry.lessons,
      }).where(eq(journalEntries.id, review.journalEntry.id));

      const existingScore = overview.proficiencyScores.find((score) => score.id === review.updatedScore.id);
      if (existingScore) {
        await tx.update(proficiencyScores).set({
          score: review.updatedScore.score,
          unlocks: review.updatedScore.unlocks,
          evidence: review.updatedScore.evidence,
          updatedAt: new Date(review.updatedScore.updatedAt),
        }).where(eq(proficiencyScores.id, review.updatedScore.id));
      } else {
        await tx.insert(proficiencyScores).values({
          id: review.updatedScore.id,
          userId: overview.user.id,
          category: review.updatedScore.category,
          label: review.updatedScore.label,
          score: review.updatedScore.score,
          unlocks: review.updatedScore.unlocks,
          evidence: review.updatedScore.evidence,
          updatedAt: new Date(review.updatedScore.updatedAt),
        });
      }

      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actor: "journal_reviewer",
        action: "reviewed_journal_entry",
        target: review.journalEntry.id,
        metadata: {
          reviewId: review.review.id,
          qualityScore: review.review.qualityScore,
          proficiencyDelta: review.review.proficiencyDelta,
          mistakePatterns: review.review.mistakePatterns,
        },
        createdAt: new Date(review.review.createdAt),
      });
    });

    return review;
  }

  async getJournalEntries(): Promise<JournalEntry[]> {
    return (await this.getMarketPilotOverview()).journalEntries;
  }

  async getJournalReviews(): Promise<JournalReview[]> {
    await this.ensureSeeded();
    const rows = await this.db.select().from(journalReviews).orderBy(desc(journalReviews.createdAt));
    return rows.map((row) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      qualityScore: row.qualityScore,
      mistakePatterns: row.mistakePatterns ?? [],
      disciplineSignals: row.disciplineSignals ?? [],
      feedback: row.feedback ?? [],
      proficiencyCategory: row.proficiencyCategory as JournalReview["proficiencyCategory"],
      proficiencyDelta: row.proficiencyDelta,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getRagRuns(): Promise<RagRun[]> {
    const rows = await this.db.select().from(ragRuns).orderBy(desc(ragRuns.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      query: row.query,
      chunkCount: row.chunkCount,
      confidence: row.confidence,
      sourceFreshness: row.sourceFreshness as RagRun["sourceFreshness"],
      citationIds: row.citationIds,
      chunkIds: row.chunkIds,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveRagRun(run: RagRun): Promise<RagRun> {
    await this.ensureSeeded();
    await this.db.insert(ragRuns).values({
      id: run.id,
      userId: run.userId,
      query: run.query,
      chunkCount: run.chunkCount,
      confidence: run.confidence,
      sourceFreshness: run.sourceFreshness,
      citationIds: run.citationIds,
      chunkIds: run.chunkIds,
      createdAt: new Date(run.createdAt),
    }).onConflictDoUpdate({
      target: ragRuns.id,
      set: {
        query: run.query,
        chunkCount: run.chunkCount,
        confidence: run.confidence,
        sourceFreshness: run.sourceFreshness,
        citationIds: run.citationIds,
        chunkIds: run.chunkIds,
        createdAt: new Date(run.createdAt),
      },
    });
    return run;
  }

  async getRagDocuments(): Promise<RagDocument[]> {
    await this.ensureSeeded();
    const rows = await this.db.select().from(ragDocuments).orderBy(desc(ragDocuments.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      runId: row.runId,
      kind: row.kind,
      text: row.text,
      metadata: row.metadata,
      timestamp: row.timestamp.toISOString(),
      chunkIds: row.chunkIds,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveRagDocuments(documents: RagDocument[]): Promise<RagDocument[]> {
    await this.ensureSeeded();
    await this.db.transaction(async (tx) => {
      for (const document of documents) {
        await tx.insert(ragDocuments).values({
          id: document.id,
          userId: document.userId,
          runId: document.runId,
          kind: document.kind,
          text: document.text,
          metadata: document.metadata,
          timestamp: new Date(document.timestamp),
          chunkIds: document.chunkIds,
          createdAt: new Date(document.createdAt),
        }).onConflictDoUpdate({
          target: ragDocuments.id,
          set: {
            runId: document.runId,
            kind: document.kind,
            text: document.text,
            metadata: document.metadata,
            timestamp: new Date(document.timestamp),
            chunkIds: document.chunkIds,
            createdAt: new Date(document.createdAt),
          },
        });
      }
    });
    return documents;
  }

  async getAiEvaluations(): Promise<AIEvaluationRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db.select().from(aiEvaluations).orderBy(desc(aiEvaluations.generatedAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      artifactId: row.artifactId,
      artifactType: row.artifactType,
      promptVersion: row.promptVersion,
      outputSummary: row.outputSummary,
      overallScore: row.overallScore,
      requiredActions: row.requiredActions,
      generatedAt: row.generatedAt.toISOString(),
    }));
  }

  async saveAiEvaluation(record: AIEvaluationRecord): Promise<AIEvaluationRecord> {
    await this.ensureSeeded();
    await this.db.insert(aiEvaluations).values({
      id: record.id,
      userId: record.userId,
      artifactId: record.artifactId,
      artifactType: record.artifactType,
      promptVersion: record.promptVersion,
      outputSummary: record.outputSummary,
      overallScore: record.overallScore,
      requiredActions: record.requiredActions,
      generatedAt: new Date(record.generatedAt),
    }).onConflictDoUpdate({
      target: aiEvaluations.id,
      set: {
        userId: record.userId,
        artifactId: record.artifactId,
        artifactType: record.artifactType,
        promptVersion: record.promptVersion,
        outputSummary: record.outputSummary,
        overallScore: record.overallScore,
        requiredActions: record.requiredActions,
        generatedAt: new Date(record.generatedAt),
      },
    });
    return record;
  }

  async getIngestionRuns(): Promise<IngestionRunRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.completedAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      providerId: row.providerId,
      status: row.status as IngestionRunRecord["status"],
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt.toISOString(),
      records: row.records,
      freshness: {
        newestTimestamp: row.freshnessNewestTimestamp?.toISOString() ?? null,
        oldestTimestamp: row.freshnessOldestTimestamp?.toISOString() ?? null,
      },
      errors: row.errors,
    }));
  }

  async saveIngestionRun(record: IngestionRunRecord): Promise<IngestionRunRecord> {
    await this.ensureSeeded();
    await this.db.insert(ingestionRuns).values({
      id: record.id,
      userId: record.userId,
      providerId: record.providerId,
      status: record.status,
      startedAt: new Date(record.startedAt),
      completedAt: new Date(record.completedAt),
      records: record.records,
      freshnessNewestTimestamp: record.freshness.newestTimestamp ? new Date(record.freshness.newestTimestamp) : null,
      freshnessOldestTimestamp: record.freshness.oldestTimestamp ? new Date(record.freshness.oldestTimestamp) : null,
      errors: record.errors,
    }).onConflictDoUpdate({
      target: ingestionRuns.id,
      set: {
        userId: record.userId,
        providerId: record.providerId,
        status: record.status,
        startedAt: new Date(record.startedAt),
        completedAt: new Date(record.completedAt),
        records: record.records,
        freshnessNewestTimestamp: record.freshness.newestTimestamp ? new Date(record.freshness.newestTimestamp) : null,
        freshnessOldestTimestamp: record.freshness.oldestTimestamp ? new Date(record.freshness.oldestTimestamp) : null,
        errors: record.errors,
      },
    });
    return record;
  }

  private async ensureSeeded() {
    if (this.seeded) return;

    const existingModules = await this.db.select({ id: learningModules.id }).from(learningModules).limit(1);
    if (existingModules.length === 0) {
      await this.seedDatabase(createSeedOverview());
    }

    this.seeded = true;
  }

  private async seedDatabase(overview: MarketPilotOverview) {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: overview.user.id,
        username: "marketpilot-demo",
        password: "demo-disabled",
      }).onConflictDoNothing();

      await tx.insert(proficiencyScores).values(overview.proficiencyScores.map((score) => ({
        id: score.id,
        userId: overview.user.id,
        category: score.category,
        label: score.label,
        score: score.score,
        unlocks: score.unlocks,
        evidence: score.evidence,
        updatedAt: new Date(score.updatedAt),
      }))).onConflictDoNothing();

      await tx.insert(learningModules).values(overview.modules.map((module) => ({
        id: module.id,
        stage: module.stage,
        title: module.title,
        domain: module.domain,
        level: module.level,
        progress: module.progress,
        requiredScore: module.requiredScore,
        status: module.status,
        lessons: module.lessons,
        gates: module.gates,
      }))).onConflictDoNothing();

      const verifications = [
        ...overview.researchReports.map((report) => report.verification),
        ...overview.tradeTickets.map((ticket) => ticket.verification),
      ];
      for (const verification of dedupeById(verifications)) {
        await tx.insert(verificationChecks).values(toVerificationRow(verification)).onConflictDoNothing();
      }

      await tx.insert(researchReports).values(overview.researchReports.map((report) => ({
        id: report.id,
        verificationCheckId: report.verification.id,
        agent: report.agent,
        title: report.title,
        asset: report.asset,
        summary: report.summary,
        mainCause: report.mainCause,
        secondaryCauses: report.secondaryCauses,
        riskFactors: report.riskFactors,
        classification: report.classification,
        confidence: report.confidence,
        generatedAt: new Date(report.generatedAt),
      }))).onConflictDoNothing();

      await tx.insert(riskRules).values(overview.riskRules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        limit: rule.limit,
        status: rule.status,
        description: rule.description,
        enabled: true,
      }))).onConflictDoNothing();

      await tx.insert(riskSettings).values({
        id: overview.riskSettings.id,
        userId: overview.user.id,
        maxRiskPerTradePct: overview.riskSettings.maxRiskPerTradePct,
        reduceSizeAbovePct: overview.riskSettings.reduceSizeAbovePct,
        maxDailyLossPct: overview.riskSettings.maxDailyLossPct,
        maxWeeklyLossPct: overview.riskSettings.maxWeeklyLossPct,
        maxSinglePositionPct: overview.riskSettings.maxSinglePositionPct,
        maxOptionsPremiumPct: overview.riskSettings.maxOptionsPremiumPct,
        noTradeBeforeHighImpactEventHours: overview.riskSettings.noTradeBeforeHighImpactEventHours,
        updatedAt: new Date(overview.riskSettings.updatedAt),
      }).onConflictDoNothing();

      await tx.insert(complianceProfiles).values({
        id: overview.complianceProfile.id,
        userId: overview.user.id,
        disclosuresAccepted: overview.complianceProfile.disclosuresAccepted,
        disclosureVersion: overview.complianceProfile.disclosureVersion,
        acceptedAt: overview.complianceProfile.acceptedAt ? new Date(overview.complianceProfile.acceptedAt) : null,
        userConfirmation: overview.complianceProfile.userConfirmation,
        updatedAt: new Date(overview.complianceProfile.updatedAt),
      }).onConflictDoNothing();

      await tx.insert(paperPortfolios).values({
        id: overview.portfolio.id,
        userId: overview.user.id,
        name: overview.portfolio.name,
        totalValue: overview.portfolio.totalValue,
        cash: overview.portfolio.cash,
        ytdReturnPct: overview.portfolio.ytdReturnPct,
        maxDrawdownPct: overview.portfolio.maxDrawdownPct,
        riskScore: overview.portfolio.riskScore,
        updatedAt: new Date(),
      }).onConflictDoNothing();

      await tx.insert(holdings).values(overview.portfolio.holdings.map((holding) => ({
        id: `${overview.portfolio.id}-${holding.symbol}`,
        portfolioId: overview.portfolio.id,
        symbol: holding.symbol,
        name: holding.name,
        allocation: holding.allocation,
        value: holding.value,
        dailyChangePct: holding.dailyChangePct,
        riskContribution: holding.riskContribution,
      }))).onConflictDoNothing();

      for (const ticket of overview.tradeTickets) {
        await tx.insert(riskChecks).values({
          id: ticket.riskCheck.id,
          tradeTicketId: ticket.id,
          decision: ticket.riskCheck.decision,
          score: ticket.riskCheck.score,
          reasons: ticket.riskCheck.reasons,
          requiredActions: ticket.riskCheck.requiredActions,
          checkedAt: new Date(ticket.riskCheck.checkedAt),
        }).onConflictDoNothing();
        await tx.insert(tradeTickets).values(toTradeTicketRow(ticket, overview.user.id)).onConflictDoNothing();
      }

      await tx.insert(journalEntries).values(overview.journalEntries.map((entry) => ({
        id: entry.id,
        userId: overview.user.id,
        linkedTicketId: entry.linkedTicketId,
        title: entry.title,
        qualityScore: entry.qualityScore,
        notes: entry.notes,
        lessons: entry.lessons,
        createdAt: new Date(entry.createdAt),
      }))).onConflictDoNothing();

      await tx.insert(auditLogs).values(overview.auditLogs.map((event) => ({
        id: event.id,
        actor: event.actor,
        action: event.action,
        target: event.target,
        metadata: {},
        createdAt: new Date(event.createdAt),
      }))).onConflictDoNothing();
    });
  }

  private async loadOverview(): Promise<MarketPilotOverview> {
    const seed = createSeedOverview();
    const [
      proficiencyRows,
      moduleRows,
      verificationRows,
      researchRows,
      riskRuleRows,
      riskSettingRows,
      complianceRows,
      portfolioRows,
      holdingRows,
      riskCheckRows,
      ticketRows,
      journalRows,
      auditRows,
    ] = await Promise.all([
      this.db.select().from(proficiencyScores),
      this.db.select().from(learningModules),
      this.db.select().from(verificationChecks),
      this.db.select().from(researchReports).orderBy(desc(researchReports.generatedAt)),
      this.db.select().from(riskRules),
      this.db.select().from(riskSettings).limit(1),
      this.db.select().from(complianceProfiles).limit(1),
      this.db.select().from(paperPortfolios).limit(1),
      this.db.select().from(holdings),
      this.db.select().from(riskChecks),
      this.db.select().from(tradeTickets).orderBy(desc(tradeTickets.createdAt)),
      this.db.select().from(journalEntries).orderBy(desc(journalEntries.createdAt)),
      this.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)),
    ]);

    const verificationById = new Map(verificationRows.map((row) => [row.id, fromVerificationRow(row)]));
    const riskCheckByTicketId = new Map(riskCheckRows.filter((row) => row.tradeTicketId).map((row) => [row.tradeTicketId!, fromRiskCheckRow(row)]));
    const portfolioRow = portfolioRows[0];
    const portfolio: PaperPortfolio = portfolioRow
      ? {
          id: portfolioRow.id,
          name: portfolioRow.name,
          totalValue: portfolioRow.totalValue,
          cash: portfolioRow.cash,
          ytdReturnPct: portfolioRow.ytdReturnPct,
          maxDrawdownPct: portfolioRow.maxDrawdownPct,
          riskScore: portfolioRow.riskScore,
          holdings: holdingRows
            .filter((row) => row.portfolioId === portfolioRow.id)
            .map((row) => ({
              symbol: row.symbol,
              name: row.name,
              allocation: row.allocation,
              value: row.value,
              dailyChangePct: row.dailyChangePct,
              riskContribution: row.riskContribution,
            })),
        }
      : seed.portfolio;
    const loadedProficiencyScores: ProficiencyScore[] = proficiencyRows.map((row) => ({
      id: row.id,
      category: row.category as ProficiencyScore["category"],
      label: row.label,
      score: row.score,
      unlocks: row.unlocks,
      evidence: row.evidence,
      updatedAt: row.updatedAt.toISOString(),
    }));

    return {
      ...seed,
      progression: deriveProgression(loadedProficiencyScores, seed.progression),
      proficiencyScores: loadedProficiencyScores,
      modules: moduleRows.map((row) => ({
        id: row.id,
        stage: row.stage as LearningModule["stage"],
        title: row.title,
        domain: row.domain,
        level: row.level as LearningModule["level"],
        progress: row.progress,
        requiredScore: row.requiredScore,
        status: row.status as LearningModule["status"],
        lessons: row.lessons,
        gates: row.gates,
      })),
      researchReports: researchRows.map((row) => ({
        id: row.id,
        agent: row.agent as ResearchReport["agent"],
        title: row.title,
        asset: row.asset ?? undefined,
        summary: row.summary,
        mainCause: row.mainCause,
        secondaryCauses: row.secondaryCauses,
        riskFactors: row.riskFactors,
        classification: row.classification as ResearchReport["classification"],
        confidence: row.confidence,
        generatedAt: row.generatedAt.toISOString(),
        verification: verificationById.get(row.verificationCheckId ?? "") ?? seed.researchReports[0].verification,
      })),
      riskRules: riskRuleRows.map((row) => ({
        id: row.id,
        label: row.label,
        limit: row.limit,
        status: row.status as RiskRule["status"],
        description: row.description,
      })),
      riskSettings: riskSettingRows[0]
        ? {
            id: riskSettingRows[0].id,
            maxRiskPerTradePct: riskSettingRows[0].maxRiskPerTradePct,
            reduceSizeAbovePct: riskSettingRows[0].reduceSizeAbovePct,
            maxDailyLossPct: riskSettingRows[0].maxDailyLossPct,
            maxWeeklyLossPct: riskSettingRows[0].maxWeeklyLossPct,
            maxSinglePositionPct: riskSettingRows[0].maxSinglePositionPct,
            maxOptionsPremiumPct: riskSettingRows[0].maxOptionsPremiumPct,
            noTradeBeforeHighImpactEventHours: riskSettingRows[0].noTradeBeforeHighImpactEventHours,
            updatedAt: riskSettingRows[0].updatedAt.toISOString(),
        }
        : seed.riskSettings,
      complianceProfile: complianceRows[0]
        ? {
            id: complianceRows[0].id,
            disclosuresAccepted: complianceRows[0].disclosuresAccepted,
            disclosureVersion: complianceRows[0].disclosureVersion,
            acceptedAt: complianceRows[0].acceptedAt?.toISOString() ?? null,
            userConfirmation: complianceRows[0].userConfirmation ?? null,
            requiredDisclosures: seed.complianceProfile.requiredDisclosures,
            updatedAt: complianceRows[0].updatedAt.toISOString(),
          }
        : seed.complianceProfile,
      portfolio,
      tradeTickets: ticketRows.map((row) => ({
        id: row.id,
        asset: row.asset,
        direction: row.direction as TradeTicket["direction"],
        quantity: row.quantity,
        entryPrice: row.entryPrice,
        stopLoss: row.stopLoss ?? undefined,
        takeProfit: row.takeProfit ?? undefined,
        timeHorizon: row.timeHorizon,
        rationale: row.rationale,
        supportingEvidence: row.supportingEvidence,
        riskAmount: row.riskAmount,
        portfolioImpact: row.portfolioImpact,
        alternativeChoices: row.alternativeChoices,
        exitCriteria: row.exitCriteria,
        invalidationCondition: row.invalidationCondition,
        confidence: row.confidence,
        status: row.status as TradeTicket["status"],
        verification: verificationById.get(row.verificationCheckId ?? "") ?? seed.tradeTickets[0].verification,
        riskCheck: riskCheckByTicketId.get(row.id) ?? seed.tradeTickets[0].riskCheck,
        createdAt: row.createdAt.toISOString(),
      })),
      journalEntries: journalRows.map((row) => ({
        id: row.id,
        title: row.title,
        linkedTicketId: row.linkedTicketId ?? undefined,
        qualityScore: row.qualityScore,
        notes: row.notes,
        lessons: row.lessons,
        createdAt: row.createdAt.toISOString(),
      })),
      auditLogs: auditRows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        target: row.target,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

export function createStorage(): IStorage {
  if (getStorageMode() === "postgres") {
    const validation = validateDatabaseUrl();
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    return new PgStorage(createDatabase());
  }

  return new MemStorage();
}

export const storage = createStorage();

export function createSeedOverview(): MarketPilotOverview {
  const now = new Date().toISOString();

  const proficiencyScores: ProficiencyScore[] = [
    {
      id: "prof-market-basics",
      category: "market_basics",
      label: "Market Basics",
      score: 68,
      unlocks: ["Paper trading sandbox"],
      evidence: ["Passed market structure quiz", "Explained ETF creation/redemption flow"],
      updatedAt: now,
    },
    {
      id: "prof-risk",
      category: "risk_management",
      label: "Risk Management",
      score: 54,
      unlocks: [],
      evidence: ["Needs better drawdown sizing discipline in simulations"],
      updatedAt: now,
    },
    {
      id: "prof-macro",
      category: "macroeconomics",
      label: "Macroeconomics",
      score: 61,
      unlocks: ["Macro scenario drills"],
      evidence: ["Correctly linked yields, dollar strength, and equity duration risk"],
      updatedAt: now,
    },
    {
      id: "prof-options",
      category: "options",
      label: "Options",
      score: 32,
      unlocks: [],
      evidence: ["Options spreads remain locked until max-loss concepts are demonstrated"],
      updatedAt: now,
    },
    {
      id: "prof-portfolio",
      category: "portfolio_construction",
      label: "Portfolio Construction",
      score: 57,
      unlocks: [],
      evidence: ["Built a starter ETF allocation but exceeded sector concentration in one attempt"],
      updatedAt: now,
    },
    {
      id: "prof-trading-psychology",
      category: "trading_psychology",
      label: "Trading Psychology",
      score: 45,
      unlocks: [],
      evidence: ["Journal quality gate requires consistent plan-following evidence"],
      updatedAt: now,
    },
  ];

  const progression: Progression = {
    currentStage: "foundation",
    stageLabel: "Stage 1: Foundation Mode",
    nextStage: "research_paper",
    paperTradingUnlock: "available",
    liveTradingUnlock: "locked",
    requirementsToAdvance: [
      "Reach 60+ in market basics, macroeconomics, risk management, and portfolio construction",
      "Complete a paper trading journal with at least five reviewed entries",
      "Build a diversified sample portfolio without concentration or leverage breaches",
      "Explain one market event using facts, interpretations, and predictions separately",
    ],
    blockedBy: [
      "Risk management score below 60",
      "Options score below the simulation unlock threshold",
      "Live trading disabled by policy until Stage 3",
    ],
  };

  const modules: LearningModule[] = [
    {
      id: "module-market-structure",
      stage: "foundation",
      title: "Market Structure and Order Types",
      domain: "Market Basics",
      level: "beginner",
      progress: 76,
      requiredScore: 60,
      status: "unlocked",
      lessons: 8,
      gates: ["Concept exam", "Explain bid/ask spread", "Paper order walkthrough"],
    },
    {
      id: "module-risk-sizing",
      stage: "foundation",
      title: "Risk, Drawdowns, and Position Sizing",
      domain: "Risk Management",
      level: "beginner",
      progress: 42,
      requiredScore: 60,
      status: "unlocked",
      lessons: 10,
      gates: ["Position sizing drill", "Drawdown quiz", "Journal review"],
    },
    {
      id: "module-macro-regimes",
      stage: "research_paper",
      title: "Macro Regimes and Asset Class Behavior",
      domain: "Macroeconomics",
      level: "intermediate",
      progress: 18,
      requiredScore: 70,
      status: "available",
      lessons: 9,
      gates: ["Rate shock simulation", "Inflation surprise scenario", "Evidence-backed explanation"],
    },
    {
      id: "module-options-safety",
      stage: "research_paper",
      title: "Options Max Loss and Assignment Risk",
      domain: "Options",
      level: "intermediate",
      progress: 0,
      requiredScore: 70,
      status: "locked",
      lessons: 12,
      gates: ["Max loss quiz", "Greeks simulation", "Margin safety assessment"],
    },
  ];

  const verification = {
    id: "verify-payrolls-yields",
    status: "partially_verified" as const,
    confidence: 78,
    evidenceSummary:
      "The explanation is supported by rising short-term yields, a firmer dollar, and lower equity index futures after the labor data release.",
    contradictoryEvidence: [
      "Eurozone PMI data also improved, which could limit EUR/USD downside.",
      "Equity breadth did not deteriorate as much as index price action suggested.",
    ],
    whatWouldDisprove:
      "If yields reverse lower while the dollar remains bid, the move is likely driven by a different catalyst.",
    sources: [
      {
        name: "Demo macro calendar feed",
        timestamp: now,
        reliability: "medium" as const,
      },
      {
        name: "Demo rates snapshot",
        timestamp: now,
        reliability: "medium" as const,
      },
    ],
  };

  const researchReports: ResearchReport[] = [
    {
      id: "report-macro-yields",
      agent: "macro",
      title: "Yields Reprice After Stronger Labor Data",
      summary:
        "Risk assets are softer as traders reduce near-term rate-cut expectations. The move is most visible in short-duration Treasuries, the dollar, and rate-sensitive growth sectors.",
      mainCause: "Higher short-term Treasury yields after stronger-than-expected employment data.",
      secondaryCauses: ["Dollar strength", "Lower Fed cut odds", "Pressure on long-duration equities"],
      riskFactors: ["Fed speaker risk", "Inflation data revision", "Liquidity fade near market close"],
      classification: "interpretation",
      confidence: 78,
      generatedAt: now,
      verification,
    },
    {
      id: "report-etf-overlap",
      agent: "etf",
      title: "Portfolio ETF Overlap Warning",
      asset: "VTI / QQQM / XLK",
      summary:
        "The sample portfolio has too much implicit mega-cap technology exposure across broad-market and sector ETFs.",
      mainCause: "Top holdings overlap across broad-market, Nasdaq, and technology-sector ETFs.",
      secondaryCauses: ["Growth factor concentration", "High correlation during volatility spikes"],
      riskFactors: ["Single-factor drawdown", "Valuation compression", "Crowded positioning"],
      classification: "fact",
      confidence: 84,
      generatedAt: now,
      verification: {
        ...verification,
        id: "verify-etf-overlap",
        status: "verified",
        evidenceSummary: "The holdings overlap claim is directly observable from ETF constituent data in the demo dataset.",
        contradictoryEvidence: [],
      },
    },
  ];

  const riskSettings: RiskSettings = {
    id: "risk-settings-demo",
    maxRiskPerTradePct: 1,
    reduceSizeAbovePct: 0.5,
    maxDailyLossPct: 2,
    maxWeeklyLossPct: 4,
    maxSinglePositionPct: 15,
    maxOptionsPremiumPct: 1,
    noTradeBeforeHighImpactEventHours: 24,
    updatedAt: now,
  };
  const riskRules = riskRulesFromSettings(riskSettings);
  const complianceProfile: ComplianceProfile = {
    id: "compliance-profile-demo",
    disclosuresAccepted: false,
    disclosureVersion: "marketpilot-risk-v1",
    acceptedAt: null,
    userConfirmation: null,
    requiredDisclosures: [
      "MarketPilot AI is not a guaranteed-profit system.",
      "Trading involves risk and can result in losses.",
      "Options, forex, futures, and margin can cause substantial losses.",
      "AI explanations, research, and predictions can be wrong.",
      "The user remains responsible for every decision.",
      "Past performance does not guarantee future results.",
      "Personalized recommendations may require legal and regulatory review before public launch.",
    ],
    updatedAt: now,
  };

  const portfolio: PaperPortfolio = {
    id: "paper-core",
    name: "Foundation Paper Portfolio",
    totalValue: 100000,
    cash: 12000,
    ytdReturnPct: 3.8,
    maxDrawdownPct: -4.6,
    riskScore: 41,
    holdings: [
      { symbol: "VTI", name: "Total US Stock Market ETF", allocation: 42, value: 42000, dailyChangePct: 0.4, riskContribution: 38 },
      { symbol: "VXUS", name: "Total International Stock ETF", allocation: 18, value: 18000, dailyChangePct: -0.1, riskContribution: 17 },
      { symbol: "BND", name: "Total Bond Market ETF", allocation: 22, value: 22000, dailyChangePct: 0.2, riskContribution: 20 },
      { symbol: "SGOV", name: "Short Treasury ETF", allocation: 6, value: 6000, dailyChangePct: 0.0, riskContribution: 2 },
    ],
  };

  const tradeTickets: TradeTicket[] = [
    {
      id: "ticket-sgov-rebalance",
      asset: "SGOV",
      direction: "buy",
      quantity: 40,
      entryPrice: 100.42,
      timeHorizon: "3 to 6 months",
      rationale:
        "Shift a small amount of idle cash into short-duration Treasury exposure while preserving liquidity during Foundation Mode.",
      supportingEvidence: ["Cash balance is 12%", "Short-duration Treasury ETF has low duration risk", "No leverage or options involved"],
      riskAmount: 0,
      portfolioImpact: "Raises short Treasury allocation from 6% to about 10% and reduces cash from 12% to about 8%.",
      alternativeChoices: ["Hold cash", "Use a money market fund", "Delay until next quiz checkpoint"],
      exitCriteria: "Rebalance back to target if cash falls below 5% or risk score exceeds 50.",
      invalidationCondition: "Do not proceed if liquidity needs change or short-term Treasury thesis is no longer suitable.",
      confidence: 72,
      status: "proposed",
      verification: {
        ...verification,
        id: "verify-sgov-ticket",
        status: "verified",
        confidence: 81,
        evidenceSummary: "The proposed paper ticket is consistent with the current demo portfolio and no-live-execution policy.",
        contradictoryEvidence: ["Cash may be preferable while the user is still below the risk-management gate."],
      },
      riskCheck: {
        id: "risk-sgov-ticket",
        decision: "approve",
        score: 88,
        reasons: ["No leverage", "No options", "Position remains below concentration limit", "Paper-only workflow"],
        requiredActions: ["User must write a journal rationale before paper fill"],
        checkedAt: now,
      },
      createdAt: now,
    },
    {
      id: "ticket-qqq-call",
      asset: "QQQ 30D Call",
      direction: "buy",
      quantity: 1,
      entryPrice: 5.2,
      timeHorizon: "30 days",
      rationale: "Speculative upside exposure after technology pullback.",
      supportingEvidence: ["Momentum watchlist flagged oversold conditions"],
      riskAmount: 520,
      portfolioImpact: "Adds options premium risk before options proficiency has been demonstrated.",
      alternativeChoices: ["Paper-watch only", "Study options max-loss module", "Use broad ETF paper trade instead"],
      exitCriteria: "Exit if premium loses 50% or thesis is invalidated.",
      invalidationCondition: "Options module remains locked until proficiency improves.",
      confidence: 45,
      status: "risk_rejected",
      verification: {
        ...verification,
        id: "verify-qqq-call",
        status: "requires_human_review",
        confidence: 44,
        evidenceSummary: "The catalyst is weak and the options education gate is not satisfied.",
      },
      riskCheck: {
        id: "risk-qqq-call",
        decision: "require_quiz",
        score: 22,
        reasons: ["Options score below 70", "Speculative premium risk", "No completed assignment-risk assessment"],
        requiredActions: ["Complete Options Max Loss module", "Pass options safety quiz", "Use simulator before any paper options ticket"],
        checkedAt: now,
      },
      createdAt: now,
    },
  ];

  const journalEntries: JournalEntry[] = [
    {
      id: "journal-rate-shock",
      title: "Rate Shock Scenario Review",
      qualityScore: 73,
      notes:
        "Correctly reduced duration risk, but the initial allocation change was larger than the written plan allowed.",
      lessons: ["Predefine maximum action size", "Separate emergency cash from tactical cash", "Avoid reacting before checking event calendar"],
      createdAt: now,
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: "audit-seed-1",
      actor: "system",
      action: "initialized_marketpilot_mvp",
      target: "demo-user",
      metadata: { stage: "foundation", liveTradingEnabled: false },
      createdAt: now,
    },
    {
      id: "audit-seed-2",
      actor: "risk_officer",
      action: "rejected_options_ticket_until_quiz",
      target: "ticket-qqq-call",
      metadata: { requiredAction: "Complete options safety quiz" },
      createdAt: now,
    },
  ];

  return {
    user: {
      id: "demo-user",
      name: "MarketPilot Learner",
      liveTradingEnabled: false,
      paperTradingEnabled: true,
    },
    progression,
    proficiencyScores,
    modules,
    researchReports,
    riskRules,
    riskSettings,
    complianceProfile,
    portfolio,
    tradeTickets,
    journalEntries,
    auditLogs,
  };
}

function upsertScore(scores: ProficiencyScore[], nextScore: ProficiencyScore): ProficiencyScore[] {
  if (scores.some((score) => score.id === nextScore.id || score.category === nextScore.category)) {
    return scores.map((score) =>
      score.id === nextScore.id || score.category === nextScore.category ? nextScore : score,
    );
  }

  return [...scores, nextScore];
}

function getBehavioralRiskSignal(overview: MarketPilotOverview) {
  const tradingPsychologyScore = overview.proficiencyScores.find((score) => score.category === "trading_psychology")?.score;
  const latestJournal = overview.journalEntries[0];
  const latestReviewEvent = overview.auditLogs.find((event) => event.action === "reviewed_journal_entry");
  const rawMistakePatterns = latestReviewEvent?.metadata?.mistakePatterns;
  const mistakePatterns = Array.isArray(rawMistakePatterns)
    ? rawMistakePatterns.filter((item): item is string => typeof item === "string")
    : [];

  return {
    tradingPsychologyScore,
    recentJournalQuality: latestJournal?.qualityScore,
    mistakePatterns,
  };
}

function riskRulesFromSettings(settings: RiskSettings): RiskRule[] {
  return [
    {
      id: "risk-per-trade",
      label: "Max risk per trade",
      limit: `${settings.reduceSizeAbovePct.toFixed(2)}% reduce / ${settings.maxRiskPerTradePct.toFixed(2)}% reject`,
      status: "active",
      description: "Tickets above the reduce threshold require smaller size; tickets above the reject threshold are blocked.",
    },
    {
      id: "risk-daily-weekly-loss",
      label: "Daily and weekly loss limits",
      limit: `${settings.maxDailyLossPct.toFixed(2)}% daily / ${settings.maxWeeklyLossPct.toFixed(2)}% weekly`,
      status: "active",
      description: "Paper trading should pause when configured loss limits are breached.",
    },
    {
      id: "risk-options-premium",
      label: "Options premium at risk",
      limit: `${settings.maxOptionsPremiumPct.toFixed(2)}% maximum`,
      status: "warning",
      description: "Options simulations require proficiency gates and capped premium at risk.",
    },
    {
      id: "risk-concentration",
      label: "Single position allocation",
      limit: `${settings.maxSinglePositionPct.toFixed(2)}% maximum`,
      status: "active",
      description: "Portfolio checks flag overconcentrated holdings before tickets advance.",
    },
    {
      id: "risk-event-window",
      label: "High-impact event window",
      limit: `${settings.noTradeBeforeHighImpactEventHours} hour cooling-off window`,
      status: "active",
      description: "Risk-sensitive tickets are blocked before major events unless explicitly reviewed.",
    },
    {
      id: "risk-live-disabled",
      label: "Live execution",
      limit: "Disabled until Stage 3",
      status: "active",
      description: "The app can educate, simulate, and paper trade only.",
    },
  ];
}

function calculatePaperPnl(ticket: TradeTicket, exitPrice: number) {
  const directionMultiplier = ticket.direction === "sell" || ticket.direction === "short" ? -1 : 1;
  const realizedPnl = Number(((exitPrice - ticket.entryPrice) * ticket.quantity * directionMultiplier).toFixed(2));
  const notional = ticket.entryPrice * ticket.quantity;
  const returnPct = notional > 0 ? Number(((realizedPnl / notional) * 100).toFixed(2)) : 0;

  return { realizedPnl, returnPct };
}

function toVerificationRow(verification: TradeTicket["verification"] | ResearchReport["verification"]) {
  return {
    id: verification.id,
    status: verification.status,
    confidence: verification.confidence,
    evidenceSummary: verification.evidenceSummary,
    contradictoryEvidence: verification.contradictoryEvidence,
    whatWouldDisprove: verification.whatWouldDisprove,
    sources: verification.sources,
    createdAt: new Date(verification.sources[0]?.timestamp ?? new Date().toISOString()),
  };
}

function fromVerificationRow(row: typeof verificationChecks.$inferSelect): TradeTicket["verification"] {
  return {
    id: row.id,
    status: row.status as TradeTicket["verification"]["status"],
    confidence: row.confidence,
    evidenceSummary: row.evidenceSummary,
    contradictoryEvidence: row.contradictoryEvidence,
    whatWouldDisprove: row.whatWouldDisprove,
    sources: row.sources.map((source) => ({
      name: source.name,
      url: source.url,
      timestamp: source.timestamp,
      reliability: source.reliability as "high" | "medium" | "low",
    })),
  };
}

function fromRiskCheckRow(row: typeof riskChecks.$inferSelect): TradeTicket["riskCheck"] {
  return {
    id: row.id,
    decision: row.decision as TradeTicket["riskCheck"]["decision"],
    score: row.score,
    reasons: row.reasons,
    requiredActions: row.requiredActions,
    checkedAt: row.checkedAt.toISOString(),
  };
}

function toTradeTicketRow(ticket: TradeTicket, userId: string) {
  return {
    id: ticket.id,
    userId,
    verificationCheckId: ticket.verification.id,
    riskCheckId: ticket.riskCheck.id,
    asset: ticket.asset,
    direction: ticket.direction,
    quantity: ticket.quantity,
    entryPrice: ticket.entryPrice,
    stopLoss: ticket.stopLoss,
    takeProfit: ticket.takeProfit,
    timeHorizon: ticket.timeHorizon,
    rationale: ticket.rationale,
    supportingEvidence: ticket.supportingEvidence,
    portfolioImpact: ticket.portfolioImpact,
    alternativeChoices: ticket.alternativeChoices,
    exitCriteria: ticket.exitCriteria,
    invalidationCondition: ticket.invalidationCondition,
    status: ticket.status,
    riskAmount: ticket.riskAmount,
    confidence: ticket.confidence,
    createdAt: new Date(ticket.createdAt),
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}
