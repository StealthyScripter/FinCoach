export type BrokerCredentialStatus = "active" | "disabled" | "missing";

export type BrokerCredential = {
  provider: string;
  accountId: string;
  tokenReference: string;
  environment: string;
  createdAt: string;
  lastUsed: string | null;
  status: BrokerCredentialStatus;
};

export interface CredentialVault {
  put(credential: BrokerCredential): Promise<void>;
  get(provider: string): Promise<BrokerCredential | undefined>;
  markUsed(provider: string, at?: Date): Promise<BrokerCredential | undefined>;
  list(): Promise<BrokerCredential[]>;
}

export class InMemoryCredentialVault implements CredentialVault {
  private readonly credentials = new Map<string, BrokerCredential>();

  async put(credential: BrokerCredential) {
    this.credentials.set(credential.provider, { ...credential });
  }

  async get(provider: string) {
    const value = this.credentials.get(provider);
    return value ? { ...value } : undefined;
  }

  async markUsed(provider: string, at = new Date()) {
    const value = this.credentials.get(provider);
    if (!value) return undefined;
    value.lastUsed = at.toISOString();
    return { ...value };
  }

  async list() {
    return Array.from(this.credentials.values()).map((value) => ({ ...value }));
  }
}

export class EnvironmentCredentialVault implements CredentialVault {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async put(): Promise<void> {
    throw new Error("EnvironmentCredentialVault is read-only");
  }

  async get(provider: string) {
    if (provider !== "oanda") return undefined;
    const accountId = this.env.OANDA_ACCOUNT_ID?.trim() ?? "";
    const tokenConfigured = Boolean(this.env.OANDA_API_TOKEN?.trim());
    const environment = this.env.OANDA_ENV?.trim().toLowerCase() || "practice";
    return {
      provider,
      accountId,
      tokenReference: tokenConfigured ? "env:OANDA_API_TOKEN" : "missing",
      environment,
      createdAt: "environment",
      lastUsed: null,
      status: accountId && tokenConfigured && environment === "practice" ? "active" as const : "missing" as const,
    };
  }

  async markUsed(provider: string, at = new Date()) {
    const value = await this.get(provider);
    return value ? { ...value, lastUsed: at.toISOString() } : undefined;
  }

  async list() {
    const credential = await this.get("oanda");
    return credential ? [credential] : [];
  }
}

const SENSITIVE_KEY = /(token|authorization|api[-_]?key|secret|password|account[_-]?id|signature)/i;
const TELEGRAM_BOT_TOKEN = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const OPENAI_API_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/g;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item),
      ]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(TELEGRAM_BOT_TOKEN, "[REDACTED]")
      .replace(OPENAI_API_KEY, "[REDACTED]");
  }
  return value;
}
