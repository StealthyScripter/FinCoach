import { randomUUID } from "crypto";
import { z } from "zod";
import type { ResearchReport } from "@shared/schema";

export const aiSafetySchema = z.object({
  liveTradingBlocked: z.literal(true),
  autonomousExecutionBlocked: z.literal(true),
  notes: z.array(z.string()),
});

export const aiTextCompletionSchema = z.object({
  text: z.string(),
}).passthrough();

export const aiResearchDraftSchema = z.object({
  thesis: z.string(),
  facts: z.array(z.string()),
  interpretations: z.array(z.string()),
  predictions: z.array(z.string()),
  supportingEvidence: z.array(z.string()),
  contradictoryEvidence: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  citations: z.array(z.object({
    name: z.string(),
    timestamp: z.string(),
    reliability: z.enum(["low", "medium", "high"]),
  })),
  riskFactors: z.array(z.string()),
  invalidationCriteria: z.string(),
  affectedAssets: z.array(z.string()),
  verificationStatus: z.enum(["verified", "partially_verified", "unverified"]),
}).passthrough();

export const structuredOutputSchemas = {
  text_completion: aiTextCompletionSchema,
  research_draft: aiResearchDraftSchema,
} as const;

export type StructuredSchemaName = keyof typeof structuredOutputSchemas;

export type AIProviderHealth = {
  provider: "demo" | "openai";
  configured: boolean;
  status: "healthy" | "disabled" | "degraded";
  model: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  estimatedCostUsd: number;
  promptVersion: string;
  lastRequestId?: string;
  lastError?: string;
  safety: { liveTradingBlocked: boolean; autonomousExecutionBlocked: boolean; notes: string[] };
};

export type StructuredReasoningRequest = {
  prompt: string;
  schemaName: StructuredSchemaName | (string & {});
  promptVersion?: string;
  metadata?: Record<string, unknown>;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type StructuredReasoningResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  provider: AIProviderHealth["provider"];
  model: string;
  requestId: string;
  attempts: number;
  latencyMs: number;
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

const structuredOutputSchemasRecord: Record<string, z.ZodTypeAny> = structuredOutputSchemas;

export class DemoAIProvider implements AIProvider {
  private usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private lastRequestId = "";

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
    const requestId = randomUUID();
    const startedAt = Date.now();
    const promptTokens = estimateTokens(request.prompt);
    const output = validateStructuredOutput(request, demoStructuredOutput(request)) as T;
    const completionTokens = estimateTokens(JSON.stringify(output));
    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;
    this.usage.totalTokens += promptTokens + completionTokens;
    this.lastRequestId = requestId;
    return {
      provider: "demo",
      model: request.model ?? "marketpilot-demo-model",
      requestId,
      attempts: 1,
      latencyMs: Date.now() - startedAt,
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
      configured: false,
      status: "healthy",
      model: "marketpilot-demo-model",
      tokenUsage: this.usage,
      estimatedCostUsd: 0,
      promptVersion: "marketpilot-demo-v1",
      lastRequestId: this.lastRequestId || undefined,
      safety,
    };
  }
}

export class OpenAIProvider implements AIProvider {
  private usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private lastRequestId = "";
  private lastError = "";

  constructor(private readonly apiKey = process.env.OPENAI_API_KEY, private readonly timeoutMs = 12_000) {}

  async complete(prompt: string) {
    return this.reason<{ text: string }>({ prompt, schemaName: "text_completion", promptVersion: "marketpilot-openai-v1" });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) return demoEmbedding(text);
    return demoEmbedding(text);
  }

  async reason<T extends Record<string, unknown>>(request: StructuredReasoningRequest): Promise<StructuredReasoningResult<T>> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    if (!this.apiKey) {
      const demo = new DemoAIProvider();
      const result = await demo.reason<T>(request);
      this.lastRequestId = result.requestId;
      return result;
    }
    const maxRetries = Math.max(0, request.maxRetries ?? 2);
    const model = request.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: "You are MarketPilot's auditable research assistant. Return only valid JSON.",
              },
              {
                role: "user",
                content: [
                  `Prompt version: ${request.promptVersion ?? "marketpilot-openai-v1"}`,
                  `Schema: ${request.schemaName}`,
                  `Prompt: ${request.prompt}`,
                  request.metadata ? `Metadata: ${JSON.stringify(request.metadata)}` : "Metadata: none",
                  "Return a JSON object only.",
                ].join("\n"),
              },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`OpenAI request failed with ${response.status}: ${body.slice(0, 240)}`);
        }
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error("OpenAI response did not include message content.");
        const parsed = JSON.parse(content) as unknown;
        const output = validateStructuredOutput(request, parsed) as T;
        const promptTokens = payload.usage?.prompt_tokens ?? estimateTokens(request.prompt);
        const completionTokens = payload.usage?.completion_tokens ?? estimateTokens(JSON.stringify(output));
        this.usage.promptTokens += promptTokens;
        this.usage.completionTokens += completionTokens;
        this.usage.totalTokens += promptTokens + completionTokens;
        this.lastRequestId = requestId;
        this.lastError = "";
        return {
          provider: "openai",
          model,
          requestId,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          output,
          tokenUsage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
          estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
          promptVersion: request.promptVersion ?? "marketpilot-openai-v1",
          safety,
        };
      } catch (error) {
        lastError = error;
        this.lastError = error instanceof Error ? error.message : String(error);
        if (attempt > maxRetries) {
          const demo = new DemoAIProvider();
          const fallback = await demo.reason<T>(request);
          this.lastRequestId = fallback.requestId;
          return fallback;
        }
        await delay(150 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenAI provider failed.");
  }

  health(): AIProviderHealth {
    const model = this.apiKey ? (process.env.OPENAI_MODEL ?? "gpt-4.1-mini") : "marketpilot-demo-model";
    return {
      provider: "openai",
      configured: Boolean(this.apiKey),
      status: this.apiKey ? (this.lastError ? "degraded" : "healthy") : "disabled",
      model,
      tokenUsage: this.usage,
      estimatedCostUsd: estimateCostUsd(model, this.usage.promptTokens, this.usage.completionTokens),
      promptVersion: "marketpilot-openai-v1",
      lastRequestId: this.lastRequestId || undefined,
      lastError: this.lastError || undefined,
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

function estimateCostUsd(model: string, promptTokens: number, completionTokens: number) {
  const pricing = model.startsWith("gpt-4")
    ? { prompt: 0.00000015, completion: 0.0000006 }
    : { prompt: 0.0000001, completion: 0.0000004 };
  return Number(((promptTokens * pricing.prompt) + (completionTokens * pricing.completion)).toFixed(6));
}

function demoEmbedding(text: string) {
  const vector = Array.from({ length: 16 }, (_, index) => {
    const code = text.charCodeAt(index % Math.max(1, text.length)) || 0;
    return Number((((code % 31) / 31) - 0.5).toFixed(4));
  });
  return vector;
}

function validateStructuredOutput(request: StructuredReasoningRequest, output: unknown) {
  const schema = structuredOutputSchemasRecord[request.schemaName] ?? z.record(z.unknown());
  return schema.parse(output);
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
