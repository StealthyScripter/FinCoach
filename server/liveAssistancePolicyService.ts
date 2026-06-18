import type { BrokerReadiness, LiveAssistancePolicy, MarketPilotOverview } from "@shared/schema";

export class LiveAssistancePolicyService {
  evaluate({
    overview,
    brokerReadiness,
    now = new Date(),
  }: {
    overview: MarketPilotOverview;
    brokerReadiness: BrokerReadiness[];
    now?: Date;
  }): LiveAssistancePolicy {
    const interactiveBrokers = brokerReadiness.find((item) => item.broker === "interactive_brokers");
    const requiredActions = unique([
      ...overview.progression.blockedBy,
      ...(interactiveBrokers?.requiredActions ?? []),
      overview.complianceProfile.disclosuresAccepted ? null : "Acknowledge MarketPilot risk, AI, and responsibility disclosures.",
      overview.progression.currentStage === "supervised_live" ? null : "Reach Supervised Live Assistance Mode before any live broker workflow.",
      overview.user.liveTradingEnabled ? null : "Enable the supervised-live feature flag after compliance approval.",
    ]);
    const canRequestLivePreview = requiredActions.length === 0 && interactiveBrokers?.liveExecutionAllowed === true;

    return {
      status: canRequestLivePreview ? "eligible_read_only" : "blocked",
      canRequestLivePreview,
      canPlaceLiveOrder: false,
      currentStage: overview.progression.currentStage,
      requiredActions,
      prohibitedCapabilities: [
        "Autonomous live order placement",
        "Naked options",
        "Margin trading",
        "Forex or futures execution",
        "Averaging down without a predefined plan",
        "Bypassing Risk Officer or Verification Agent approval",
      ],
      complianceNotices: [
        "MarketPilot AI is not a guaranteed-profit system.",
        "Trading, options, forex, futures, and margin can cause substantial losses.",
        "AI explanations and predictions can be wrong.",
        "The user remains responsible for every investment decision.",
        "Past performance does not guarantee future results.",
        "Legal review is required before public launch of personalized recommendations.",
      ],
      riskOfficerVeto: true,
      generatedAt: now.toISOString(),
    };
  }
}

export const liveAssistancePolicyService = new LiveAssistancePolicyService();

function unique(items: Array<string | null>) {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}
