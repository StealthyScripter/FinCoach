export type DemoRunEnvCheck = {
  key: string;
  status: "configured" | "missing" | "invalid" | "redacted";
  message: string;
};

const SECRET_KEYS = new Set([
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "OANDA_API_TOKEN",
  "OANDA_ACCOUNT_ID",
  "METATRADER_DEMO_BRIDGE_SECRET",
  "METATRADER_BRIDGE_SECRET",
]);

const LIVE_FLAG_KEYS = [
  "MARKETPILOT_ENABLE_LIVE_TRADING",
  "MARKETPILOT_PRODUCTION_LIVE_EXECUTION",
  "MARKETPILOT_ALLOW_LIVE_EXECUTION",
  "ENABLE_LIVE_TRADING",
  "LIVE_TRADING_ENABLED",
  "EXECUTION_MODE",
  "BROKER_ENV",
];

export function validateDemoRunEnvironment(env: NodeJS.ProcessEnv = process.env): DemoRunEnvCheck[] {
  const checks: DemoRunEnvCheck[] = [
    required("DATABASE_URL", env),
    equals("MARKETPILOT_RUN_MODE", env, "demo_observation"),
    telegramAllowedUser(env),
    required("TELEGRAM_BOT_TOKEN", env),
    required("TELEGRAM_WEBHOOK_SECRET", env),
    demoOnlyEnabled(env),
    liveFlagsDisabled(env),
    oandaPracticeOnly(env),
    metaTraderDemoOnly(env),
  ];
  return checks.map(redactCheck);
}

function demoOnlyEnabled(env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  return env.MARKETPILOT_DEMO_ONLY?.trim().toLowerCase() === "false"
    ? { key: "MARKETPILOT_DEMO_ONLY", status: "invalid", message: "MARKETPILOT_DEMO_ONLY cannot be disabled." }
    : { key: "MARKETPILOT_DEMO_ONLY", status: "configured", message: "MarketPilot demo-only mode is enforced." };
}

function required(key: string, env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  return env[key]?.trim()
    ? { key, status: SECRET_KEYS.has(key) ? "redacted" : "configured", message: `${key} is configured.` }
    : { key, status: "missing", message: `${key} is missing.` };
}

function equals(key: string, env: NodeJS.ProcessEnv, expected: string): DemoRunEnvCheck {
  const actual = env[key]?.trim();
  if (!actual) return { key, status: "missing", message: `${key} is missing.` };
  return actual === expected
    ? { key, status: "configured", message: `${key} is ${expected}.` }
    : { key, status: "invalid", message: `${key} must be ${expected}.` };
}

function liveFlagsDisabled(env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  const enabled = LIVE_FLAG_KEYS.filter((key) => {
    const value = env[key]?.trim().toLowerCase();
    if (!value) return false;
    if (["EXECUTION_MODE", "BROKER_ENV"].includes(key)) return ["live", "real", "production", "prod"].includes(value);
    return truthy(env[key]);
  });
  return enabled.length === 0
    ? { key: "production_live_execution", status: "configured", message: "Live account execution flags are disabled." }
    : { key: "production_live_execution", status: "invalid", message: `Live account execution flag is enabled: ${enabled.join(", ")}.` };
}

function telegramAllowedUser(env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  if (env.TELEGRAM_ALLOWED_USER_ID?.trim()) {
    return { key: "TELEGRAM_ALLOWED_USER_ID", status: "configured", message: "TELEGRAM_ALLOWED_USER_ID is configured." };
  }
  if (env.TELEGRAM_CHAT_ID?.trim()) {
    return { key: "TELEGRAM_ALLOWED_USER_ID", status: "configured", message: "TELEGRAM_CHAT_ID is configured as the allowed Telegram control ID." };
  }
  return { key: "TELEGRAM_ALLOWED_USER_ID", status: "missing", message: "TELEGRAM_ALLOWED_USER_ID is missing." };
}

function oandaPracticeOnly(env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  const configured = Boolean(env.OANDA_API_TOKEN?.trim() || env.OANDA_ACCOUNT_ID?.trim() || env.OANDA_ENV?.trim());
  if (!configured) {
    return { key: "OANDA_ENV", status: "configured", message: "OANDA is not configured; practice-only adapter remains inactive." };
  }
  const value = env.OANDA_ENV?.trim().toLowerCase();
  return value === "practice"
    ? { key: "OANDA_ENV", status: "configured", message: "OANDA is configured for practice." }
    : { key: "OANDA_ENV", status: "invalid", message: "OANDA_ENV must be practice when OANDA is configured." };
}

function metaTraderDemoOnly(env: NodeJS.ProcessEnv): DemoRunEnvCheck {
  const demoUrl = env.METATRADER_DEMO_BRIDGE_URL?.trim();
  const legacyUrl = env.METATRADER_BRIDGE_URL?.trim();
  const mode = env.METATRADER_ENV?.trim().toLowerCase();
  if (mode === "live" || env.METATRADER_LIVE_BRIDGE_URL?.trim()) {
    return { key: "METATRADER_DEMO_BRIDGE_URL", status: "invalid", message: "MetaTrader live bridge configuration is rejected for demo observation." };
  }
  if (demoUrl) {
    return { key: "METATRADER_DEMO_BRIDGE_URL", status: "configured", message: "MetaTrader demo bridge is configured." };
  }
  if (legacyUrl) {
    return { key: "METATRADER_DEMO_BRIDGE_URL", status: "invalid", message: "Use METATRADER_DEMO_BRIDGE_URL so the bridge is explicitly demo-only." };
  }
  return { key: "METATRADER_DEMO_BRIDGE_URL", status: "configured", message: "MetaTrader demo bridge is not configured; bridge remains inactive." };
}

function redactCheck(check: DemoRunEnvCheck): DemoRunEnvCheck {
  if (!SECRET_KEYS.has(check.key)) return check;
  return check.status === "configured"
    ? { ...check, status: "redacted", message: `${check.key} is configured and redacted.` }
    : check;
}

function truthy(value: string | undefined) {
  return ["1", "true", "yes", "enabled", "on"].includes(value?.trim().toLowerCase() ?? "");
}
