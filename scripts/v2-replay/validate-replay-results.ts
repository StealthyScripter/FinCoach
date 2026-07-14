import { readdirSync, readFileSync } from "fs";
import { validateReplayResult } from "../../server/v2/replay-verification";

const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "artifacts/v2-replay/verify";
const summary = JSON.parse(readFileSync(`${output}/summary.json`, "utf8"));
const validation = validateReplayResult(summary, readdirSync(output));
console.log(JSON.stringify(validation));
if (!validation.ok) process.exit(1);
