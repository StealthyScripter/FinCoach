import type { OrchestrationErrorCode } from "./contracts";

export function classifyOrchestrationError(error: unknown): { code: OrchestrationErrorCode; retryable: boolean; terminal: boolean } {
  if (error && typeof error === "object" && "retryable" in error && (error as { retryable?: boolean }).retryable === true) {
    return { code: "retryable_dependency_failure", retryable: true, terminal: false };
  }
  if (error instanceof Error && /poison/i.test(error.message)) return { code: "poison_event", retryable: false, terminal: true };
  return { code: "unknown_failure", retryable: false, terminal: true };
}
