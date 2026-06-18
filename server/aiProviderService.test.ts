import assert from "node:assert/strict";
import { DemoAIProvider, OpenAIProvider } from "./aiProviderService";

const demo = new DemoAIProvider();
const result = await demo.reason({
  prompt: "Draft a verified market explanation.",
  schemaName: "research_draft",
  promptVersion: "test-prompt-v1",
});

assert.equal(result.provider, "demo");
assert.equal(result.promptVersion, "test-prompt-v1");
assert.equal(result.safety.liveTradingBlocked, true);
assert.equal(result.safety.autonomousExecutionBlocked, true);
assert.equal(typeof result.output.thesis, "string");
assert.ok(result.tokenUsage.totalTokens > 0);
assert.ok(demo.health().tokenUsage.totalTokens >= result.tokenUsage.totalTokens);

const embedding = await demo.embed("SPY rates risk");
assert.equal(embedding.length, 16);

const openaiDisabled = new OpenAIProvider(undefined);
assert.equal(openaiDisabled.health().status, "disabled");
const fallback = await openaiDisabled.reason({ prompt: "Fallback", schemaName: "text_completion" });
assert.equal(fallback.provider, "demo");

console.log("aiProviderService smoke tests passed");
