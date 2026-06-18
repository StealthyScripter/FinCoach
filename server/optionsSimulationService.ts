import type { OptionsSimulation, OptionsSimulationRequest, ProficiencyScore } from "@shared/schema";

const CONTRACT_MULTIPLIER = 100;

export class OptionsSimulationService {
  simulate(request: OptionsSimulationRequest, proficiencyScores: ProficiencyScore[]): OptionsSimulation {
    const lowerBound = Math.max(0.01, request.underlyingPrice * 0.5);
    const upperBound = request.underlyingPrice * 1.5;
    const step = (upperBound - lowerBound) / 20;
    const sampledPrices = [
      0,
      ...request.legs.map((leg) => leg.strike),
      ...Array.from({ length: 21 }, (_, index) => Number((lowerBound + step * index).toFixed(2))),
    ].sort((a, b) => a - b);
    const priceRange = Array.from(new Set(sampledPrices)).map((price) => {
      return {
        price,
        payoff: Number(calculatePayoff(request, price).toFixed(2)),
      };
    });

    const netDebit = calculateNetDebit(request);
    const payoffs = priceRange.map((point) => point.payoff);
    const netCallContracts = request.legs
      .filter((leg) => leg.type === "call")
      .reduce((sum, leg) => sum + (leg.action === "buy" ? leg.contracts : -leg.contracts), 0);
    const hasUnlimitedProfit = netCallContracts > 0;
    const hasUnlimitedLoss = netCallContracts < 0;
    const maxProfit = hasUnlimitedProfit ? null : Math.max(...payoffs);
    const maxLoss = hasUnlimitedLoss ? null : Math.abs(Math.min(...payoffs));
    const optionsScore =
      proficiencyScores.find((score) => score.category === "options")?.score ?? 0;
    const requiredScore = request.legs.length > 1 ? 85 : 70;

    return {
      underlying: request.underlying.toUpperCase(),
      strategyName: classifyStrategy(request),
      underlyingPrice: request.underlyingPrice,
      daysToExpiration: request.daysToExpiration,
      impliedVolatilityPct: request.impliedVolatilityPct,
      netDebit: Number(netDebit.toFixed(2)),
      maxLoss: maxLoss === null ? null : Number(maxLoss.toFixed(2)),
      maxProfit: maxProfit === null ? null : Number(maxProfit.toFixed(2)),
      breakevens: findBreakevens(priceRange),
      priceRange,
      riskRewardSummary: buildRiskRewardSummary(maxLoss, maxProfit, netDebit),
      assignmentRisk: buildAssignmentRisk(request),
      proficiencyGate: {
        requiredScore,
        currentScore: optionsScore,
        unlocked: optionsScore >= requiredScore,
        requiredActions:
          optionsScore >= requiredScore
            ? ["Use paper simulation only", "Document max loss and assignment risk before any ticket"]
            : [
                `Raise options proficiency to ${requiredScore}+`,
                "Complete max-loss and assignment-risk lessons",
                "Keep this strategy in simulation mode",
              ],
      },
      safetyNotes: [
        "This is an educational payoff simulation, not a recommendation.",
        "Live options execution remains locked.",
        "Real outcomes can differ because of bid/ask spreads, early assignment, volatility changes, and liquidity.",
      ],
    };
  }
}

export const optionsSimulationService = new OptionsSimulationService();

function calculatePayoff(request: OptionsSimulationRequest, priceAtExpiration: number): number {
  return request.legs.reduce((sum, leg) => {
    const intrinsic =
      leg.type === "call"
        ? Math.max(0, priceAtExpiration - leg.strike)
        : Math.max(0, leg.strike - priceAtExpiration);
    const signedOptionValue = leg.action === "buy" ? intrinsic - leg.premium : leg.premium - intrinsic;
    return sum + signedOptionValue * CONTRACT_MULTIPLIER * leg.contracts;
  }, 0);
}

function calculateNetDebit(request: OptionsSimulationRequest): number {
  return request.legs.reduce((sum, leg) => {
    const signedPremium = leg.action === "buy" ? leg.premium : -leg.premium;
    return sum + signedPremium * CONTRACT_MULTIPLIER * leg.contracts;
  }, 0);
}

function classifyStrategy(request: OptionsSimulationRequest): string {
  if (request.legs.length === 1) {
    const [leg] = request.legs;
    return `${leg.action === "buy" ? "Long" : "Short"} ${leg.type}`;
  }

  const calls = request.legs.filter((leg) => leg.type === "call");
  const puts = request.legs.filter((leg) => leg.type === "put");
  if (calls.length === 2 && request.legs.length === 2) return "Call spread";
  if (puts.length === 2 && request.legs.length === 2) return "Put spread";
  if (calls.length === 1 && puts.length === 1) return "Straddle or strangle";
  return "Multi-leg options strategy";
}

function findBreakevens(priceRange: Array<{ price: number; payoff: number }>): number[] {
  const breakevens = new Set<number>();
  for (let index = 1; index < priceRange.length; index += 1) {
    const previous = priceRange[index - 1];
    const current = priceRange[index];
    if (current.payoff === 0) {
      breakevens.add(current.price);
    }
    if ((previous.payoff < 0 && current.payoff > 0) || (previous.payoff > 0 && current.payoff < 0)) {
      const slope = (current.payoff - previous.payoff) / (current.price - previous.price);
      const crossing = previous.price - previous.payoff / slope;
      breakevens.add(Number(crossing.toFixed(2)));
    }
  }
  return Array.from(breakevens).sort((a, b) => a - b);
}

function buildRiskRewardSummary(maxLoss: number | null, maxProfit: number | null, netDebit: number): string {
  if (maxLoss === null) {
    return "This structure has undefined upside loss risk and is not eligible for paper-ticket approval.";
  }
  const rewardText = maxProfit === null ? "unlimited modeled upside" : `$${maxProfit.toFixed(2)} modeled max profit`;
  const riskText = maxLoss === 0 ? "no modeled loss" : `$${maxLoss.toFixed(2)} modeled max loss`;
  const cashFlow = netDebit >= 0 ? `$${netDebit.toFixed(2)} net debit` : `$${Math.abs(netDebit).toFixed(2)} net credit`;
  return `${riskText}, ${rewardText}, ${cashFlow}.`;
}

function buildAssignmentRisk(request: OptionsSimulationRequest): string {
  const shortLegs = request.legs.filter((leg) => leg.action === "sell");
  if (shortLegs.length === 0) {
    return "No short option legs, so early assignment risk is not present in this simplified simulation.";
  }
  const shortTypes = Array.from(new Set(shortLegs.map((leg) => leg.type))).join(" and ");
  return `Short ${shortTypes} leg detected; early assignment and margin review must be documented before paper approval.`;
}
