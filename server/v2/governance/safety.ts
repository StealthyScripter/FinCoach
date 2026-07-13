import { DemoOnlyPolicyService } from "../../execution/demoOnlyPolicy";
import { readV2FeatureFlags } from "../contracts/module";

export function getV2CompatibilityBoundary(env: NodeJS.ProcessEnv = process.env) {
  const flags = readV2FeatureFlags(env);
  const demoOnly = new DemoOnlyPolicyService(env).validateEnvironment();
  return {
    schema: "fincoach.v2.compatibility.1",
    flags,
    v1BehaviorPreserved: true,
    liveExecutionBlocked: true,
    demoOnly,
    enabled: flags.FINCOACH_V2_ENABLED,
    researchEnabled: flags.FINCOACH_V2_ENABLED && flags.FINCOACH_V2_RESEARCH_ENABLED,
    forwardTestingEnabled: flags.FINCOACH_V2_ENABLED && flags.FINCOACH_V2_FORWARD_TESTING_ENABLED && demoOnly.safe,
    signalPublishingEnabled: flags.FINCOACH_V2_ENABLED && flags.FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED,
  };
}
