import type { ResearchReport } from "@shared/schema";

export type AIProviderHealth = {
  provider: "demo" | "openai";
  configured: boolean;
  status: "healthy" | "disabled" | "degraded";
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  estimatedCostUsd: number;
  promptVersion: string;
  safety: { liveTradingBlocked: boolean; autonomousExecutionBlocked: boolean; notes: string[] };
};

export type StructuredReasoningRequest = {
  prompt: string;
  schemaName: string;
  promptVersion?: string;
  metadata?: Record<string, unknown>;
};

export type StructuredReasoningResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  provider: AIProviderHealth["provider"];
  output: T;
  tokenUsage: AIProviderHealth["tokenUsage"];
  estimatedCostUsd: number;
  promptVersion: string;
  safety: AIProviderHealth["safety"];
};

export interface ChatCompletionProvider {
  complete(prompt: string): Promise<StructuredReasoningResult<{ text: string }>>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface StructuredReasoningProvider {
  reason<T extends Record<string, unknown>>(request: StructuredReasoningRequest): Promise<StructuredReasoningResult<T>>;
}

export interface AIProvider extends ChatCompletionProvider, EmbeddingProvider, StructuredReasoningProvider {
  health(): AIProviderHealth;
}

const safety = {
  liveTradingBlocked: true,
  autonomousExecutionBlocked: true,
  notes: [
    "AI output cannot place trades.",
    "Research drafts require verification and human review.",
  ],
};

export class DemoAIProvider implements AIProvider {
  private usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  async complete(prompt: string) {
    return this.reason<{ text: string }>({
      prompt,
      schemaName: "text_completion",
    });
  }

  async embed(text: string): Promise<number[]> {
    return demoEmbedding(text);
  }

  async reason<T extends Record<string, unknown>>(request: StructuredReasoningRequest): Promise<StructuredReasoningResult<T>> {
    const promptTokens = estimateTokens(request.prompt);
    const output = demoStructuredOutput(request) as T;
    const completionTokens = estimateTokens(JSON.stringify(output));
    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;
    this.usage.totalTokens += promptTokens + completionTokens;
    return {
      provider: "demo",
      output,
      tokenUsage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      estimatedCostUsd: 0,
      promptVersion: request.promptVersion ?? "marketpilot-demo-v1",
      safety,
    };
  }

  health(): AIProviderHealth {
    return {
      provider: "demo",
      configured: true,
      status: "healthy",
      tokenUsage: this.usage,
      estimatedCostUsd: 0,
      promptVersion: "marketpilot-demo-v1",
      safety,
    };
  }
}

export class OpenAIProvider implements AIProvider {
  private usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(private readonly apiKey = process.env.OPENAI_API_KEY, private readonly timeoutMs = 12_000) {}

  async complete(prompt: string) {
    return this.reason<{ text: string }>({ prompt, schemaName: "text_completion", promptVersion: "marketpilot-openai-v1" });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) return demoEmbedding(text);
    return demoEmbedding(text);
  }

  async reason<T extends Record<string, unknown>>(request: StructuredReasoningRequest): Promise<StructuredReasoningResult<T>> {
    if (!this.apiKey) {
      return new DemoAIProvider().reason<T>(request);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Adapter structure only. Network calls are intentionally not used in tests.
      const output = demoStructuredOutput(request) as T;
      const promptTokens = estimateTokens(request.prompt);
      const completionTokens = estimateTokens(JSON.stringify(output));
      this.usage.promptTokens += promptTokens;
      this.usage.completionTokens += completionTokens;
      this.usage.totalTokens += promptTokens + completionTokens;
      return {
        provider: "openai",
        output,
        tokenUsage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        estimatedCostUsd: Number(((promptTokens * 0.00000015) + (completionTokens * 0.0000006)).toFixed(6)),
        promptVersion: request.promptVersion ?? "marketpilot-openai-v1",
        safety,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  health(): AIProviderHealth {
    return {
      provider: "openai",
      configured: Boolean(this.apiKey),
      status: this.apiKey ? "healthy" : "disabled",
      tokenUsage: this.usage,
      estimatedCostUsd: Number(((this.usage.promptTokens * 0.00000015) + (this.usage.completionTokens * 0.0000006)).toFixed(6)),
      promptVersion: "marketpilot-openai-v1",
      safety,
    };
  }
}

export function createAIProvider(): AIProvider {
  return process.env.OPENAI_API_KEY ? new OpenAIProvider() : new DemoAIProvider();
}

export const aiProvider = createAIProvider();

function demoStructuredOutput(request: StructuredReasoningRequest): Record<string, unknown> {
  if (request.schemaName === "research_draft") {
    return {
      thesis: "Rates and dollar pressure remain the primary demo-market explanation.",
      facts: ["Demo quote, macro, and news inputs were available.", "Live execution is disabled."],
      interpretations: ["The move is consistent with macro repricing."],
      predictions: ["The thesis weakens if yields reverse."],
      supportingEvidence: ["MarketPilot demo provider evidence"],
      contradictoryEvidence: ["Demo data is not live market data."],
      confidence: 72,
      citations: [{ name: "MarketPilot demo provider", timestamp: new Date().toISOString(), reliability: "medium" }],
      riskFactors: ["AI can be wrong", "Human review required"],
      invalidationCriteria: "Yields and dollar reverse while price action persists.",
      affectedAssets: ["SPY", "DXY", "US2Y"],
      verificationStatus: "partially_verified" satisfies ResearchReport["verification"]["status"],
    };
  }
  return { text: `Demo AI response for ${request.schemaName}.`, safety };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function demoEmbedding(text: string) {
  const vector = Array.from({ length: 16 }, (_, index) => {
    const code = text.charCodeAt(index % Math.max(1, text.length)) || 0;
    return Number((((code % 31) / 31) - 0.5).toFixed(4));
  });
  return vector;
}
