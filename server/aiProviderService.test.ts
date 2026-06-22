import assert from "node:assert/strict";
import { DemoAIProvider, OpenAIProvider, createAIProvider, structuredOutputSchemas } from "./aiProviderService";

const demo = new DemoAIProvider();
const result = await demo.reason({
  prompt: "Draft a verified market explanation.",
  schemaName: "research_draft",
  promptVersion: "test-prompt-v1",
});

assert.equal(result.provider, "demo");
assert.equal(result.model, "marketpilot-demo-model");
assert.equal(result.promptVersion, "test-prompt-v1");
assert.equal(result.safety.liveTradingBlocked, true);
assert.equal(result.safety.autonomousExecutionBlocked, true);
assert.equal(typeof result.output.thesis, "string");
assert.ok(result.tokenUsage.totalTokens > 0);
assert.ok(demo.health().tokenUsage.totalTokens >= result.tokenUsage.totalTokens);
assert.equal(demo.health().model, "marketpilot-demo-model");
assert.ok(result.requestId.length > 0);
assert.equal(result.attempts, 1);
assert.ok(result.latencyMs >= 0);

const embedding = await demo.embed("SPY rates risk");
assert.equal(embedding.length, 16);

const openaiDisabled = new OpenAIProvider(undefined);
assert.equal(openaiDisabled.health().status, "disabled");
const fallback = await openaiDisabled.reason({ prompt: "Fallback", schemaName: "text_completion" });
assert.equal(fallback.provider, "demo");
assert.equal(fallback.output.text, "Demo AI response for text_completion.");

const textSchema = structuredOutputSchemas.text_completion.parse({ text: "ok", safety: { note: "ignored" } });
assert.equal(textSchema.text, "ok");

const provider = createAIProvider();
assert.equal(provider.health().configured, Boolean(process.env.OPENAI_API_KEY));
assert.equal(provider.health().provider, process.env.OPENAI_API_KEY ? "openai" : "demo");

console.log("aiProviderService smoke tests passed");
