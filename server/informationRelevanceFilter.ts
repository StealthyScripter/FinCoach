import type { PrioritizedSignal } from "@shared/schema";

export class InformationRelevanceFilter {
  selectForPrimaryView(signals: PrioritizedSignal[], count = 5): PrioritizedSignal[] {
    const visibleSignals = this.visible(signals);
    const primarySignals = visibleSignals.filter((signal) => signal.displayTier === "primary");
    const fallbackSignals = visibleSignals.filter((signal) => signal.displayTier !== "primary");

    return [...primarySignals, ...fallbackSignals].slice(0, Math.min(Math.max(count, 3), 5));
  }

  primary(signals: PrioritizedSignal[], count = 5): PrioritizedSignal[] {
    return signals.filter((signal) => signal.displayTier === "primary").slice(0, count);
  }

  secondary(signals: PrioritizedSignal[], count = 8): PrioritizedSignal[] {
    return signals.filter((signal) => signal.displayTier === "secondary").slice(0, count);
  }

  advanced(signals: PrioritizedSignal[]): PrioritizedSignal[] {
    return signals.filter((signal) => signal.displayTier === "advanced");
  }

  visible(signals: PrioritizedSignal[]): PrioritizedSignal[] {
    return signals.filter((signal) => signal.displayTier !== "hidden");
  }
}

export const informationRelevanceFilter = new InformationRelevanceFilter();
