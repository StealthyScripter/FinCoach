import assert from "node:assert/strict";
import { marketMovementExplanationSchema } from "@shared/schema";
import { marketMovementExplainer } from "./marketMovementExplainer";

const explanation = await marketMovementExplainer.explain("SPY");

marketMovementExplanationSchema.parse(explanation);

assert.equal(explanation.symbol, "SPY");
assert.equal(explanation.primaryCause, explanation.mainCause);
assert.ok(explanation.facts.length >= 3);
assert.ok(explanation.interpretations.length >= 3);
assert.ok(explanation.predictions.length >= 1);
assert.ok(explanation.sourceTimestamps.length >= 2);
assert.ok(explanation.verification.sources.length === explanation.sourceTimestamps.length);
assert.ok(explanation.riskFactors.some((risk) => /approval/.test(risk)));
assert.ok(explanation.whatWouldInvalidate.length > 20);

console.log("marketMovementExplainer smoke tests passed");
