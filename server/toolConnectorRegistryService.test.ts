import assert from "node:assert/strict";
import { CostAwareProviderSelector } from "./costAwareProviderSelector";
import { ToolConnectorRegistryService } from "./toolConnectorRegistryService";

const configuredEnv = {
  OANDA_API_TOKEN: "token",
  OANDA_ACCOUNT_ID: "account",
  OANDA_ENV: "practice",
  METATRADER_DEMO_BRIDGE_URL: "https://bridge.example",
  TELEGRAM_BOT_TOKEN: "telegram-token",
  TELEGRAM_ALLOWED_USER_ID: "123456",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_WEBHOOK_URL: "https://example.com/telegram",
  TRADINGVIEW_WEBHOOK_SECRET: "tradingview-secret",
} satisfies NodeJS.ProcessEnv;

const registry = new ToolConnectorRegistryService(configuredEnv);
const snapshot = registry.snapshot(new Date("2026-01-15T14:00:00.000Z"));

assert.ok(snapshot.connectors.some((connector) => connector.id === "analysis_tools" && connector.health === "healthy"));
assert.ok(snapshot.connectors.some((connector) => connector.id === "oanda_practice" && connector.health === "healthy"));
assert.ok(snapshot.connectors.some((connector) => connector.id === "metatrader_demo" && connector.health === "healthy"));
assert.ok(snapshot.connectors.some((connector) => connector.id === "telegram_notifications" && connector.health === "healthy"));
assert.equal(snapshot.connectors.find((connector) => connector.id === "robinhood_stub")?.health, "disabled");
assert.equal(snapshot.connectors.find((connector) => connector.id === "cash_app_stub")?.health, "disabled");
assert.equal(snapshot.connectors.find((connector) => connector.id === "tradingview_webhook")?.recentSignals, 0);
assert.deepEqual(snapshot.connectors.find((connector) => connector.id === "oanda_practice")?.requiredEnvVars, ["OANDA_API_TOKEN", "OANDA_ACCOUNT_ID", "OANDA_ENV"]);
assert.deepEqual(snapshot.connectors.find((connector) => connector.id === "oanda_practice")?.missingEnvVars, []);
assert.ok((snapshot.connectors.find((connector) => connector.id === "telegram_notifications")?.supportedActions ?? []).includes("kill_switch_control"));
assert.ok((snapshot.connectors.find((connector) => connector.id === "generic_rest_broker")?.safetyConstraints ?? []).some((item) => item.includes("Sandbox")));

const selector = new CostAwareProviderSelector();
const chosen = selector.choose([
  { id: "paid", name: "Paid Provider", costLevel: "paid", enabled: true, health: "healthy" },
  { id: "internal", name: "Internal Provider", costLevel: "internal", enabled: true, health: "healthy" },
  { id: "demo", name: "Demo Provider", costLevel: "demo", enabled: true, health: "healthy" },
]);

assert.equal(chosen.chosen?.id, "internal");
assert.ok(chosen.rationale[0]?.includes("selected"));

console.log("toolConnectorRegistryService tests passed");
