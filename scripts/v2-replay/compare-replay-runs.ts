import { readFileSync } from "fs";

const left = process.argv.includes("--left") ? process.argv[process.argv.indexOf("--left") + 1] : process.argv[2];
const right = process.argv.includes("--right") ? process.argv[process.argv.indexOf("--right") + 1] : process.argv[3];
if (!left || !right) throw new Error("Usage: compare-replay-runs --left <left-summary.json> --right <right-summary.json>");
const a = JSON.parse(readFileSync(left, "utf8"));
const b = JSON.parse(readFileSync(right, "utf8"));
const ok = a.domainEventHash === b.domainEventHash;
console.log(JSON.stringify({ ok, left: a.domainEventHash, right: b.domainEventHash }));
if (!ok) process.exit(1);
