import { operationalBlockerService, type OperationalBlockerService } from "./operationalBlockerService";

export type MarketDataProvenanceKind =
  | "REAL_PROVIDER_DATA"
  | "REAL_PROVIDER_FALLBACK"
  | "STALE_REAL_DATA"
  | "FIXTURE_DATA"
  | "SIMULATED_DATA"
  | "SYNTHETIC_DATA";

export type ExecutionMarketDataInput = {
  workflow: string;
  symbol?: string | null;
  provider?: string | null;
  fixture?: boolean;
  stale?: boolean;
  simulated?: boolean;
  synthetic?: boolean;
  fallback?: boolean;
  observedAt?: string | null;
};

export function classifyMarketDataProvenance(input: ExecutionMarketDataInput): MarketDataProvenanceKind {
  if (input.fixture) return "FIXTURE_DATA";
  if (input.simulated) return "SIMULATED_DATA";
  if (input.synthetic) return "SYNTHETIC_DATA";
  if (input.stale) return "STALE_REAL_DATA";
  if (input.fallback) return "REAL_PROVIDER_FALLBACK";
  return "REAL_PROVIDER_DATA";
}

export async function ensureRealMarketDataForExecution(
  input: ExecutionMarketDataInput,
  blockers: OperationalBlockerService = operationalBlockerService,
  now = new Date(),
) {
  const kind = classifyMarketDataProvenance(input);
  if (kind === "FIXTURE_DATA" || kind === "SIMULATED_DATA" || kind === "SYNTHETIC_DATA") {
    await blockers.record({
      kind: "dependency",
      code: `${kind.toLowerCase()}_blocked`,
      title: "Execution blocked: real market data required",
      whatBlocked: input.workflow,
      reason: `${kind} cannot be used for execution-capable or performance-evaluation workflows`,
      currentValue: kind,
      limitValue: "REAL_PROVIDER_DATA or REAL_PROVIDER_FALLBACK",
      scope: { symbol: input.symbol ?? undefined, component: input.provider ?? undefined },
      expected: false,
      action: "Configure a real market-data provider; do not substitute fixture, simulated, or synthetic data.",
      effect: "The workflow is blocked instead of evaluating fabricated market data.",
      severity: "critical",
      alertCategory: "MARKET_DATA_FAILURE",
      now,
    });
    return { ok: false as const, provenanceKind: kind, reason: "real_market_data_required" };
  }
  return { ok: true as const, provenanceKind: kind };
}
