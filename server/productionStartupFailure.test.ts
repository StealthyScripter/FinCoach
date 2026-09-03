import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/index.cjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "",
    PORT: "0",
    FINCOACH_AUTH_REQUIRED: "true",
    FINCOACH_AUTH_SESSION_SECRET: "startup-failure-test-secret",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_PAPER_EXECUTION_ENABLED: "false",
    FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false",
    FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: "false",
    MARKETPILOT_DEMO_ONLY: "true",
    OANDA_ENV: "practice",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

const [code] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
  child.once("exit", (exitCode, signal) => resolve([exitCode, signal]));
});

assert.notEqual(code, 0, `production startup without DATABASE_URL must fail nonzero; output: ${output}`);
console.log("production startup failure exit test passed");
