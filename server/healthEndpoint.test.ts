import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { configureAuth } from "./auth/service";
import { registerRoutes } from "./routes";
import { v2OperationsService } from "./v2/operations/service";

process.env.NODE_ENV = "test";
process.env.FINCOACH_AUTH_SESSION_SECRET = "health-endpoint-test-secret";
process.env.FINCOACH_AUTH_SECURE_COOKIE = "false";
process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

let v2StatusCalls = 0;
const originalStatusAsync = v2OperationsService.statusAsync.bind(v2OperationsService);
(v2OperationsService as { statusAsync: typeof v2OperationsService.statusAsync }).statusAsync = async (...args) => {
  v2StatusCalls += 1;
  return originalStatusAsync(...args);
};

const app = express();
app.use(express.json());
configureAuth(app);
const server = createServer(app);
await registerRoutes(server, app);
await listen(server);

try {
  const publicHealth = await get(server, "/api/health");
  assert.equal(publicHealth.status, 200);
  const text = await publicHealth.text();
  assert.ok(Buffer.byteLength(text, "utf8") < 4096, "public health response should be small and predictable");
  assert.equal(v2StatusCalls, 0, "public health must not compose full V2 operations status");
  assert.doesNotMatch(text, /hypothesis_insufficient_independent_occurrences|eligibleSymbols|evaluatedSymbols|pipeline|forwardTests|signals/);
  const body = JSON.parse(text);
  assert.ok(["healthy", "degraded", "unhealthy"].includes(body.status));
  assert.ok(body.subsystems.states);

  const storage = await get(server, "/api/health/storage");
  assert.equal(storage.status, 200);

  for (const path of ["/api/health/diagnostics", "/api/health/providers", "/api/health/security", "/api/health/supervisor"]) {
    const response = await get(server, path);
    assert.equal(response.status, 401, `${path} must require authentication`);
  }
} finally {
  await close(server);
}

console.log("health endpoint boundary tests passed");

function listen(server: Server) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function get(server: Server, path: string) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}
