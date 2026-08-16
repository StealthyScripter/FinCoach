import assert from "node:assert/strict";
import { AuthService, InMemoryAuthRepository, normalizeEmail, requireAuthenticatedRequest } from "./auth/service";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

assert.equal(normalizeEmail(" Operator@Example.COM "), "operator@example.com");

const repository = new InMemoryAuthRepository();
const service = new AuthService(repository, {
  FINCOACH_AUTH_ALLOWED_EMAILS: "operator@example.com, second@example.com",
  FINCOACH_AUTH_REQUIRED: "true",
} as NodeJS.ProcessEnv);

const rejectedSignup = await service.signup("outsider@example.com", "StrongPassword123!");
assert.equal(rejectedSignup.ok, false);
assert.equal(rejectedSignup.reason, "invalid_credentials");

const shortPassword = await service.signup("operator@example.com", "short");
assert.equal(shortPassword.ok, false);
assert.equal(shortPassword.reason, "password_too_short");

const created = await service.signup(" OPERATOR@example.com ", "StrongPassword123!");
assert.equal(created.ok, true);
assert.equal(created.user.email, "operator@example.com");

const duplicate = await service.signup("operator@example.com", "StrongPassword123!");
assert.equal(duplicate.ok, false);
assert.equal(duplicate.reason, "invalid_credentials");

const invalidPassword = await service.signin("operator@example.com", "WrongPassword123!");
assert.equal(invalidPassword.ok, false);
assert.equal(invalidPassword.reason, "invalid_credentials");

const signedIn = await service.signin("operator@example.com", "StrongPassword123!");
assert.equal(signedIn.ok, true);
assert.equal(signedIn.user.email, "operator@example.com");

const current = await service.currentUser(signedIn.user.id);
assert.deepEqual(current, signedIn.user);

const rateLimitedService = new AuthService(new InMemoryAuthRepository(), {
  FINCOACH_AUTH_ALLOWED_EMAILS: "rate@example.com",
  FINCOACH_AUTH_REQUIRED: "true",
} as NodeJS.ProcessEnv);
for (let attempt = 0; attempt < 5; attempt += 1) {
  const result = await rateLimitedService.signin("rate@example.com", "WrongPassword123!");
  assert.equal(result.ok, false);
}
const rateLimited = await rateLimitedService.signin("rate@example.com", "WrongPassword123!");
assert.equal(rateLimited.ok, false);
assert.equal(rateLimited.reason, "rate_limited");

let nextCalled = false;
requireAuthenticatedRequest(
  { originalUrl: "/api/telegram/webhook", path: "/telegram/webhook", method: "POST", session: {}, get: () => undefined } as never,
  { status: () => ({ json: () => undefined }) } as never,
  () => { nextCalled = true; },
);
assert.equal(nextCalled, true);

let rejectedStatus = 0;
requireAuthenticatedRequest(
  { originalUrl: "/api/portfolio/summary", path: "/portfolio/summary", method: "GET", session: {}, get: () => undefined } as never,
  { status: (code: number) => { rejectedStatus = code; return { json: () => undefined }; } } as never,
  () => { throw new Error("protected request unexpectedly allowed"); },
);
assert.equal(rejectedStatus, 401);

nextCalled = false;
requireAuthenticatedRequest(
  { originalUrl: "/api/portfolio/summary", path: "/portfolio/summary", method: "POST", session: { userId: "user-1", csrfToken: "token-1" }, get: (name: string) => name === "x-fincoach-csrf-token" ? "token-1" : undefined } as never,
  { status: () => ({ json: () => undefined }) } as never,
  () => { nextCalled = true; },
);
assert.equal(nextCalled, true);
