import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync("client/src/components/layout.tsx", "utf8");
const app = readFileSync("client/src/App.tsx", "utf8");
const research = readFileSync("client/src/pages/research-lab.tsx", "utf8");
const forward = readFileSync("client/src/pages/forward-testing.tsx", "utf8");

for (const label of ["Dashboard", "Research Lab", "Strategy Lab", "Forward Testing", "Journal", "System"]) {
  assert.ok(layout.includes(label), `missing primary nav label ${label}`);
}
for (const hidden of ["Trade Desk", "Portfolio", "Ask"]) {
  assert.ok(!layout.includes(`label: "${hidden}"`), `legacy nav label still primary: ${hidden}`);
}
assert.ok(app.includes("path=\"/research\""));
assert.ok(app.includes("path=\"/forward-testing\""));
assert.ok(forward.includes("Demo-only execution boundary"));
assert.ok(forward.includes("Unknown, live, real, and production modes fail closed."));
assert.ok(research.includes("Observations"));
assert.ok(research.includes("Patterns"));
assert.ok(research.includes("Hypotheses"));
assert.ok(research.includes("Rule Sets"));
assert.ok(research.includes("Experiments"));
assert.equal((research.match(/<Card key=/g) ?? []).length, 1);
assert.equal((forward.match(/<Card key=/g) ?? []).length, 1);

console.log("strategy machine UI tests passed");
