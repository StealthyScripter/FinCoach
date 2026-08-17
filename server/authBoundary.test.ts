import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { AuthService, configureAuth, InMemoryAuthRepository, registerAuthRoutes, requireAuthenticatedRequest } from "./auth/service";

process.env.NODE_ENV = "test";
process.env.FINCOACH_AUTH_SESSION_SECRET = "auth-boundary-test-secret";
process.env.FINCOACH_AUTH_SECURE_COOKIE = "false";

const repository = new InMemoryAuthRepository();
const service = new AuthService(repository, {
  FINCOACH_AUTH_ALLOWED_EMAILS: "operator@example.com,disabled@example.com",
  FINCOACH_AUTH_REQUIRED: "true",
  FINCOACH_AUTH_SESSION_SECRET: "auth-boundary-test-secret",
} as NodeJS.ProcessEnv);

const app = express();
app.use(express.json());
configureAuth(app);
registerAuthRoutes(app, service);
app.use("/api", requireAuthenticatedRequest);
app.get("/api/protected", (_req, res) => res.json({ ok: true }));
app.post("/api/protected", (_req, res) => res.status(201).json({ ok: true }));
app.get("*", (_req, res) => res.type("html").send(readFileSync("client/index.html", "utf8")));

const server = createServer(app);
await listen(server);

try {
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const disabledSignup = await post(base, "/api/auth/signup", {
    email: "operator@example.com",
    password: "StrongPassword123!",
  });
  assert.equal(disabledSignup.status, 403);
  assert.deepEqual(await disabledSignup.json(), { message: "Authentication failed" });
  assert.equal(await repository.findByEmail("operator@example.com"), null);

  for (const path of [
    "/api/signup",
    "/api/register",
    "/api/auth/register",
    "/api/auth/signup/admin",
  ]) {
    const guessed = await post(base, path, { email: "guessed@example.com", password: "StrongPassword123!" });
    assert.equal(guessed.status, 401, `${path} must be protected or absent`);
  }
  assert.equal(await repository.findByEmail("guessed@example.com"), null);

  for (const path of ["/signup", "/register", "/auth/signup", "/auth/register"]) {
    const guessedPage = await get(base, path);
    assert.equal(guessedPage.status, 200);
    const html = await guessedPage.text();
    assert.match(html, /src="\/src\/main\.tsx"/);
    assert.doesNotMatch(html, /\b(Sign Up|Register|Start for Free|Free Trial|Create Account|Join Now)\b/i);
  }

  const publicContact = await post(base, "/api/contact", {
    email: "visitor@example.com",
    message: "I would like to learn more.",
  });
  assert.notEqual(publicContact.status, 201);
  assert.equal(await repository.findByEmail("visitor@example.com"), null);

  const anonymousGet = await get(base, "/api/protected");
  assert.equal(anonymousGet.status, 401);
  const anonymousPost = await post(base, "/api/protected", { value: true });
  assert.equal(anonymousPost.status, 401);

  const unknownSignin = await post(base, "/api/auth/signin", {
    email: "unknown@example.com",
    password: "StrongPassword123!",
  });
  assert.equal(unknownSignin.status, 401);
  assert.equal(await repository.findByEmail("unknown@example.com"), null);

  const provisioned = await service.provisionUser("operator@example.com", "StrongPassword123!");
  assert.equal(provisioned.ok, true);
  const disabled = await service.provisionUser("disabled@example.com", "StrongPassword123!", "disabled");
  assert.equal(disabled.ok, true);

  const disabledSignin = await post(base, "/api/auth/signin", {
    email: "disabled@example.com",
    password: "StrongPassword123!",
  });
  assert.equal(disabledSignin.status, 401);

  const signin = await post(base, "/api/auth/signin", {
    email: "operator@example.com",
    password: "StrongPassword123!",
  });
  assert.equal(signin.status, 200);
  const signinCookie = cookieHeader(signin);
  assert.match(signinCookie, /fincoach\.sid=/);
  const signinBody = await signin.json() as { csrfToken: string; user: { email: string } };
  assert.equal(signinBody.user.email, "operator@example.com");
  assert.ok(signinBody.csrfToken);

  const refreshed = await get(base, "/api/auth/session", signinCookie);
  assert.equal(refreshed.status, 200);
  const refreshedBody = await refreshed.json() as { authenticated: boolean; csrfToken: string; user: { email: string } };
  assert.equal(refreshedBody.authenticated, true);
  assert.equal(refreshedBody.user.email, "operator@example.com");
  assert.equal(refreshedBody.csrfToken, signinBody.csrfToken);

  const authenticatedGet = await get(base, "/api/protected", signinCookie);
  assert.equal(authenticatedGet.status, 200);
  const missingCsrfPost = await post(base, "/api/protected", { value: true }, signinCookie);
  assert.equal(missingCsrfPost.status, 403);
  const authenticatedPost = await post(base, "/api/protected", { value: true }, signinCookie, signinBody.csrfToken);
  assert.equal(authenticatedPost.status, 201);

  const signout = await post(base, "/api/auth/signout", {}, signinCookie, signinBody.csrfToken);
  assert.equal(signout.status, 200);
  const afterLogout = await get(base, "/api/protected", signinCookie);
  assert.equal(afterLogout.status, 401);

  assertLandingBoundary();
} finally {
  await close(server);
}

function assertLandingBoundary() {
  const appSource = readFileSync("client/src/App.tsx", "utf8");
  const landingSource = stripComments(readFileSync("client/src/pages/landing.tsx", "utf8"));
  assert.match(appSource, /if \(!data\?\.authenticated\) return <Landing \/>;/);
  assert.match(landingSource, />\s*Login\s*</);
  assert.doesNotMatch(landingSource, /\b(Sign Up|Register|Start for Free|Free Trial|Create Account|Join Now)\b/i);
  assert.doesNotMatch(landingSource, /\/api\/auth\/signup/);
}

function stripComments(source: string) {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : undefined });
}

async function post(base: string, path: string, body: unknown, cookie?: string, csrfToken?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { "x-fincoach-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response) {
  return response.headers.getSetCookie?.().map((value) => value.split(";")[0]).join("; ")
    ?? response.headers.get("set-cookie")?.split(",").map((value) => value.split(";")[0]).join("; ")
    ?? "";
}
