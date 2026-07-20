import { getFinCoachV2Runtime } from "../server/v2/runtime/composition";

const command = process.argv[2] ?? "status";
const runtime = getFinCoachV2Runtime();

async function main() {
  try {
    await runtime.initialize();
    if (command === "status" || command === "pilot:status") {
      console.log(JSON.stringify(runtime.status(), null, 2));
      return;
    }
    if (command === "start" || command === "pilot:start") {
      console.log(JSON.stringify(await runtime.resume(), null, 2));
      return;
    }
    if (command === "run-once" || command === "pilot:run-once") {
      console.log(JSON.stringify(await runtime.runOnce({ requestedBy: command }), null, 2));
      return;
    }
    if (command === "pause" || command === "pilot:pause" || command === "stop" || command === "pilot:stop") {
      console.log(JSON.stringify(await runtime.stop(command), null, 2));
      return;
    }
    if (command === "resume" || command === "pilot:resume") {
      console.log(JSON.stringify(await runtime.resume(), null, 2));
      return;
    }
    if (command === "reconcile") {
      const status = runtime.operationsService();
      console.log(JSON.stringify(await status.statusAsync(), null, 2));
      return;
    }
    throw new Error(`Unsupported V2 runtime command: ${command}`);
  } finally {
    await runtime.stop("cli_exit").catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
