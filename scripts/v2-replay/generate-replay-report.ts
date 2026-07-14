import { readFileSync } from "fs";
import { dirname, join } from "path";

const output = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : process.argv[2]?.endsWith("summary.json")
    ? dirname(process.argv[2])
    : process.argv[2] ?? "artifacts/v2-replay/verify";
console.log(readFileSync(join(output, "report.md"), "utf8"));
