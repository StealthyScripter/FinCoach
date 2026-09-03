import type { StrategyDefinition } from "../rules";
import type { V2ResearchSignal } from "../signals";
import type { ForwardTestRecord } from "../forward-testing";

export type DemoExecutionLifecycleState = "candidate" | "focused";
export type DemoExecutionRequestStatus = "created" | "eligible" | "submitted" | "accepted" | "filled" | "rejected" | "cancelled" | "closed" | "failed";

export type DemoPromotionRecord = {
  promotionId: string;
  strategyId: string;
  authorizedForPractice: true;
  approvedBy: string;
  approvedAt: string;
  reason: string;
  lineageEventIds: string[];
};

export type DemoExecutionEligibility = {
  eligible: boolean;
  reason: string;
  strategyId: string;
  signalId: string;
  forwardTestId: string;
  lifecycleDecisionId: string | null;
  evaluatedAt: string;
};

export type V2ExecutionRequest = {
  executionRequestId: string;
  schemaVersion: "fincoach.v2.execution-request.1";
  strategyId: string;
  signalId: string;
  forwardTestId: string;
  researchLineageEventIds: string[];
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  requestedRisk: number;
  requestedUnits: number;
  eligibility: DemoExecutionEligibility;
  status: DemoExecutionRequestStatus;
  idempotencyKey: string;
  brokerOrderId: string | null;
  brokerTradeId: string | null;
  brokerFillTransactionId: string | null;
  entryPriceFilled: number | null;
  submittedAt: string | null;
  filledAt: string | null;
  closedAt: string | null;
  realizedPnL: number | null;
  realizedR: number | null;
  brokerStatus: string | null;
  createdAt: string;
  correlationId: string;
  causationId: string | null;
  lineageEventIds: string[];
};

export type DemoEligibilityInput = {
  signal: V2ResearchSignal;
  strategy: StrategyDefinition & { researchOnly?: boolean };
  forwardTest: ForwardTestRecord;
  lifecycle: { decisionId: string; toState: string } | null;
  promotion?: DemoPromotionRecord | null;
  now?: Date;
  killSwitchActive: boolean;
  practiceCapacityAvailable: boolean;
  env?: NodeJS.ProcessEnv;
};
