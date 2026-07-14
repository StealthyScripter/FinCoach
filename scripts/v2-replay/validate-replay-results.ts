import { validateReplayOutputDirectory } from "../../server/v2/replay-verification";

const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "artifacts/v2-replay/verify";
const validation = validateReplayOutputDirectory(output);
console.log(JSON.stringify(validation));
if (!validation.ok) process.exit(1);
