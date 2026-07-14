import { setTimeout as delay } from "timers/promises";
import { createHash } from "crypto";
import type { OandaDatasetBuildEnv, OandaHistoricalClient, OandaRawCandle } from "./contracts";

export const oandaTimeframeGranularity = {
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D",
  "1w": "W",
  "1mo": "M",
} as const;

export function oandaGranularity(timeframe: keyof typeof oandaTimeframeGranularity) {
  const value = oandaTimeframeGranularity[timeframe];
  if (!value) throw new Error(`Unsupported OANDA timeframe: ${timeframe}`);
  return value;
}

export function verifyOandaPracticeEnvironment(env: OandaDatasetBuildEnv) {
  if (env.OANDA_ENV?.trim().toLowerCase() !== "practice") throw new Error("OANDA dataset acquisition requires OANDA_ENV=practice");
  if (env.MARKETPILOT_DEMO_ONLY !== "true") throw new Error("OANDA dataset acquisition requires MARKETPILOT_DEMO_ONLY=true");
  if (env.FINCOACH_LIVE_EXECUTION === "enabled") throw new Error("live execution must remain blocked");
  if (!env.OANDA_API_TOKEN?.trim()) throw new Error("OANDA_API_TOKEN is required");
  if (!env.OANDA_ACCOUNT_ID?.trim()) throw new Error("OANDA_ACCOUNT_ID is required");
  const baseUrl = env.OANDA_BASE_URL ?? "https://api-fxpractice.oanda.com/v3";
  const host = new URL(baseUrl).hostname;
  if (!["api-fxpractice.oanda.com", "localhost", "127.0.0.1"].includes(host) || /api-fxtrade/i.test(baseUrl)) throw new Error("OANDA live endpoint is rejected");
  return { baseUrl, accountId: env.OANDA_ACCOUNT_ID, tokenHash: createHash("sha256").update(env.OANDA_API_TOKEN).digest("hex").slice(0, 8) };
}

export class OandaPracticeHistoricalClient implements OandaHistoricalClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly accountId: string;
  constructor(env: OandaDatasetBuildEnv, private readonly fetchImpl: typeof fetch = fetch) {
    const verified = verifyOandaPracticeEnvironment(env);
    this.baseUrl = verified.baseUrl;
    this.token = env.OANDA_API_TOKEN!;
    this.accountId = verified.accountId;
  }

  async listInstruments(): Promise<string[]> {
    const payload = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/instruments`) as { instruments?: Array<{ name?: string }> };
    return (payload.instruments ?? []).map(item => String(item.name)).filter(Boolean).sort();
  }

  async fetchCandles(input: { instrument: string; granularity: string; from: string; to: string; price: string; count: number }) {
    const path = `/instruments/${encodeURIComponent(input.instrument)}/candles`;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("price", input.price);
    url.searchParams.set("granularity", input.granularity);
    url.searchParams.set("from", input.from);
    url.searchParams.set("to", input.to);
    url.searchParams.set("count", String(input.count));
    const response = await this.fetchImpl(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${this.token}`, "User-Agent": "FinCoach-OandaHistoricalDataset/1.0" } });
    if (response.status === 429) return { candles: [], requestId: response.headers.get("requestid"), retryAfterMs: Math.max(0, Number(response.headers.get("retry-after") ?? 1) * 1000) };
    if (!response.ok) throw new Error(`OANDA historical candles failed with status ${response.status}`);
    const payload = await response.json() as { candles?: OandaRawCandle[] };
    return { candles: payload.candles ?? [], requestId: response.headers.get("requestid"), retryAfterMs: null };
  }

  private async request(path: string) {
    if (/orders|trades|positions|close/i.test(path)) throw new Error("OANDA historical client refuses execution endpoint");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "GET", headers: { Authorization: `Bearer ${this.token}`, "User-Agent": "FinCoach-OandaHistoricalDataset/1.0" } });
    if (!response.ok) throw new Error(`OANDA practice request failed with status ${response.status}`);
    return response.json();
  }
}

export async function waitForRateLimit(ms: number) {
  if (ms > 0) await delay(ms);
}

export function oandaPriceParameter(component: "mid" | "bid" | "ask" | "bid_ask") {
  if (component === "mid") return "M";
  if (component === "bid") return "B";
  if (component === "ask") return "A";
  return "BA";
}

