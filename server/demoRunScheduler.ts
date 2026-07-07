import { demoRunService } from "./demoRunService";

const ONE_HOUR_MS = 60 * 60 * 1000;
let demoRunSchedulerTimer: NodeJS.Timeout | null = null;

export function startDemoRunScheduler(env: NodeJS.ProcessEnv = process.env) {
  if (env.MARKETPILOT_RUN_MODE?.trim() !== "demo_observation") {
    return null;
  }
  if (demoRunSchedulerTimer) {
    return demoRunSchedulerTimer;
  }

  const tick = () => {
    void demoRunService.report().catch((error) => {
      console.error(`demo run scheduler failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  tick();
  demoRunSchedulerTimer = setInterval(tick, ONE_HOUR_MS);
  demoRunSchedulerTimer.unref();
  return demoRunSchedulerTimer;
}
