import { SandboxBrokerError } from "./brokerFailures";
import { providerRecoveryTelemetry, type ProviderRecoveryTelemetry } from "./providerRecoveryTelemetry";

export type BrokerRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export class BrokerRetryService {
  constructor(
    private readonly policy: BrokerRetryPolicy = { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 250 },
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly telemetry: ProviderRecoveryTelemetry = providerRecoveryTelemetry,
  ) {}

  async read<T>(
    operation: () => Promise<T>,
    canContinue: () => boolean = () => true,
    context: { provider: string; operation: string } = { provider: "unknown", operation: "read" },
  ) {
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      if (!canContinue()) throw new SandboxBrokerError("kill_switch_active");
      try {
        const value = await operation();
        if (attempt > 1) this.telemetry.recovered(context.provider, context.operation, attempt);
        return { value, attempts: attempt, retried: attempt > 1 };
      } catch (error) {
        const code = error instanceof SandboxBrokerError ? error.code : "unknown";
        if (!isRetryable(error) || attempt === this.policy.maxAttempts) {
          if (attempt > 1 || isRetryable(error)) this.telemetry.failed(context.provider, context.operation, attempt, code);
          throw error;
        }
        this.telemetry.attempt(context.provider, context.operation, attempt, code);
        const delay = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (attempt - 1));
        await this.sleep(delay);
      }
    }
    throw new SandboxBrokerError("order_rejected", "Broker retry attempts were exhausted.");
  }
}

function isRetryable(error: unknown) {
  return error instanceof SandboxBrokerError
    && (error.code === "rate_limited" || error.code === "provider_disconnected");
}

export const brokerRetryService = new BrokerRetryService();
