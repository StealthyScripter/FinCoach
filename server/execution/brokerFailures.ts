export type SandboxFailureCode =
  | "stale_price"
  | "order_rejected"
  | "insufficient_margin"
  | "provider_disconnected"
  | "invalid_instrument"
  | "rate_limited"
  | "token_missing"
  | "confirmation_expired"
  | "kill_switch_active"
  | "demo_environment_required";

const USER_REASONS: Record<SandboxFailureCode, string> = {
  stale_price: "The latest broker price is stale. Refresh pricing before submitting.",
  order_rejected: "The demo broker rejected the order.",
  insufficient_margin: "The demo account does not have enough available margin for this order.",
  provider_disconnected: "The demo broker is disconnected. Reconnect and sync the account.",
  invalid_instrument: "This instrument is not supported by the selected demo broker.",
  rate_limited: "The broker rate limit was reached. Wait before retrying.",
  token_missing: "Demo broker credentials are not configured.",
  confirmation_expired: "The order confirmation expired. Create and confirm a new preview.",
  kill_switch_active: "The global kill switch is active. Sandbox order submission is blocked.",
  demo_environment_required: "Only OANDA practice and MetaTrader demo environments are allowed.",
};

export class SandboxBrokerError extends Error {
  constructor(
    public readonly code: SandboxFailureCode,
    message = USER_REASONS[code],
    public readonly status = 409,
  ) {
    super(message);
    this.name = "SandboxBrokerError";
  }

  toResponse() {
    return { code: this.code, message: this.message, productionOrderSubmissionEnabled: false as const };
  }
}

export function sandboxFailureReason(code: SandboxFailureCode) {
  return USER_REASONS[code];
}

export function mapBrokerHttpFailure(status: number, detail?: string): SandboxBrokerError {
  if (status === 401 || status === 403) return new SandboxBrokerError("token_missing", undefined, status);
  if (status === 404) return new SandboxBrokerError("invalid_instrument", detail, status);
  if (status === 429) return new SandboxBrokerError("rate_limited", undefined, status);
  if (status === 400 && detail?.toLowerCase().includes("margin")) {
    return new SandboxBrokerError("insufficient_margin", detail, status);
  }
  return new SandboxBrokerError("order_rejected", detail || undefined, status);
}
