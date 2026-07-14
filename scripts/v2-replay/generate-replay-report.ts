import { readFileSync } from "fs";

const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "artifacts/v2-replay/verify";
console.log(readFileSync(`${output}/report.md`, "utf8"));
