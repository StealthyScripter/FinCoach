import { createEvent, type EventEnvelope, type EventReference } from "../core";
import type { BacktestResult } from "../backtesting";
import { ValidationEventTypes } from "./events";
import type { ValidationResult, ValidationVerdict } from "./contracts";
import { ValidationRepository } from "./repository";

const MIN_SAMPLE = 30;

export class ValidationService {
  constructor(private readonly repository = new ValidationRepository()) {}

  validate(backtestEvent: EventEnvelope) {
    const backtest = backtestEvent.payload as unknown as BacktestResult;
    const actualSampleSize = backtest.tradeCount ?? 0;
    const walkForwardScore = clamp((backtest.expectancy + 1) / 2);
    const outOfSampleScore = clamp(backtest.profitFactor / 2);
    const monteCarloRobustness = clamp(1 - backtest.maxDrawdown / Math.max(backtest.tradeCount, 1));
    const parameterStability = clamp(backtest.averageR > -0.25 ? 0.75 : 0.35);
    const regimeStability = clamp(Object.keys(backtest.regimeBreakdown ?? {}).length >= 2 ? 0.72 : 0.5);
    const symbolStability = clamp(Object.keys(backtest.symbolBreakdown ?? {}).length >= 1 ? 0.7 : 0.3);
    const evidenceScore = round(avg([walkForwardScore, outOfSampleScore, monteCarloRobustness, parameterStability, regimeStability, symbolStability]));
    const overfittingWarning = backtest.tradeCount < MIN_SAMPLE || backtest.profitFactor > 5 || regimeStability < 0.6;
    const verdict = verdictFor(actualSampleSize, evidenceScore, overfittingWarning);
    const result: ValidationResult = {
      experimentId: backtest.experimentId,
      verdict,
      evidenceScore,
      minimumSampleThreshold: MIN_SAMPLE,
      actualSampleSize,
      walkForwardScore,
      outOfSampleScore,
      monteCarloRobustness,
      parameterStability,
      regimeStability,
      symbolStability,
      overfittingWarning,
      sourceBacktestRefs: [referenceFrom(backtestEvent)],
    };
    this.repository.save(result);
    return createEvent({ type: eventTypeFor(verdict), module: "validation", payload: result as unknown as Record<string, unknown>, sourceEventRefs: result.sourceBacktestRefs });
  }
}

function verdictFor(sampleSize: number, evidenceScore: number, overfit: boolean): ValidationVerdict {
  if (sampleSize < MIN_SAMPLE) return "needs_more_data";
  if (overfit && evidenceScore < 0.75) return "reject";
  if (evidenceScore >= 0.78) return "ready_for_forward_test";
  if (evidenceScore >= 0.68) return "candidate";
  if (evidenceScore >= 0.55) return "watch";
  return "reject";
}

function eventTypeFor(verdict: ValidationVerdict) {
  if (verdict === "ready_for_forward_test") return ValidationEventTypes.ExperimentReadyForForwardTest;
  if (verdict === "reject") return ValidationEventTypes.ExperimentRejected;
  if (verdict === "needs_more_data") return ValidationEventTypes.ExperimentNeedsMoreData;
  return ValidationEventTypes.ExperimentValidated;
}

function referenceFrom(event: EventEnvelope): EventReference {
  return { eventId: event.id, eventType: event.type, module: event.module, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt };
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, round(value)));
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export const validationService = new ValidationService();
