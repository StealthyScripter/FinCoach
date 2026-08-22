import { randomBytes, randomUUID, timingSafeEqual, pbkdf2Sync } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { Pool } from "pg";
import { structuredLogger } from "../structuredLogger";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    email?: string;
    csrfToken?: string;
  }
}

export type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type PublicUser = { id: string; email: string };

const DEFAULT_ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SESSION_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

export interface AuthRepository {
  create(user: AuthUser): Promise<AuthUser>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  markLogin(id: string, at: string): Promise<void>;
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, AuthUser>();

  async create(user: AuthUser) {
    if ([...this.users.values()].some((item) => item.email === user.email)) throw new Error("auth_user_exists");
    this.users.set(user.id, user);
    return user;
  }

  async findByEmail(email: string) {
    return [...this.users.values()].find((item) => item.email === email) ?? null;
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async markLogin(id: string, at: string) {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, lastLoginAt: at, updatedAt: at });
  }
}

export class PgAuthRepository implements AuthRepository {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(databaseUrl = process.env.DATABASE_URL, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
    this.ownsPool = !pool;
  }

  async create(user: AuthUser) {
    const result = await this.pool.query(
      `INSERT INTO auth_users
        (id, email, password_hash, password_salt, password_iterations, status, created_at, updated_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [user.id, user.email, user.passwordHash, user.passwordSalt, user.passwordIterations, user.status, user.createdAt, user.updatedAt, user.lastLoginAt],
    );
    return mapUser(result.rows[0]);
  }

  async findByEmail(email: string) {
    const result = await this.pool.query("SELECT * FROM auth_users WHERE email = $1", [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findById(id: string) {
    const result = await this.pool.query("SELECT * FROM auth_users WHERE id = $1", [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async markLogin(id: string, at: string) {
    await this.pool.query("UPDATE auth_users SET last_login_at = $2, updated_at = $2 WHERE id = $1", [id, at]);
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository = createAuthRepository(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  allowedEmails() {
    return new Set((this.env.FINCOACH_AUTH_ALLOWED_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));
  }

  authRequired() {
    return this.env.FINCOACH_AUTH_REQUIRED !== "false";
  }

  publicRegistrationEnabled() {
    return this.env.PUBLIC_REGISTRATION_ENABLED === "true";
  }

  async signup(email: string, password: string, now = new Date()) {
    const normalized = normalizeEmail(email);
    if (!this.publicRegistrationEnabled()) {
      this.audit("auth_signup_rejected", normalized, "public_registration_disabled");
      return { ok: false as const, reason: "registration_disabled" };
    }
    return this.createPasswordUser(normalized, password, "active", now, "auth_signup_created");
  }

  async provisionUser(email: string, password: string, status: AuthUser["status"] = "active", now = new Date()) {
    const normalized = normalizeEmail(email);
    return this.createPasswordUser(normalized, password, status, now, "auth_user_provisioned");
  }

  private async createPasswordUser(
    normalized: string,
    password: string,
    status: AuthUser["status"],
    now: Date,
    successEvent: string,
  ) {
    if (!this.allowedEmails().has(normalized)) {
      this.audit("auth_signup_rejected", normalized, "not_allowed");
      return { ok: false as const, reason: "invalid_credentials" };
    }
    const validation = validatePassword(password);
    if (!validation.ok) return { ok: false as const, reason: validation.reason };
    if (await this.repository.findByEmail(normalized)) return { ok: false as const, reason: "invalid_credentials" };
    const hashed = hashPassword(password);
    const user = await this.repository.create({
      id: randomUUID(),
      email: normalized,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordIterations: hashed.iterations,
      status,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastLoginAt: null,
    });
    this.audit(successEvent, normalized, "created");
    return { ok: true as const, user: publicUser(user) };
  }

  async signin(email: string, password: string, now = new Date()) {
    const normalized = normalizeEmail(email);
    if (!rateLimitOk(normalized)) {
      this.audit("auth_signin_rejected", normalized, "rate_limited");
      return { ok: false as const, reason: "rate_limited" };
    }
    if (!this.allowedEmails().has(normalized)) {
      this.audit("auth_signin_rejected", normalized, "not_allowed");
      return { ok: false as const, reason: "invalid_credentials" };
    }
    const user = await this.repository.findByEmail(normalized);
    if (!user || user.status !== "active" || !verifyPassword(password, user)) {
      this.audit("auth_signin_rejected", normalized, "invalid_credentials");
      return { ok: false as const, reason: "invalid_credentials" };
    }
    await this.repository.markLogin(user.id, now.toISOString());
    authAttempts.delete(normalized);
    this.audit("auth_signin_succeeded", normalized, "authenticated");
    return { ok: true as const, user: publicUser(user) };
  }

  async currentUser(userId?: string) {
    if (!userId) return null;
    const user = await this.repository.findById(userId);
    return user && user.status === "active" ? publicUser(user) : null;
  }

  private audit(event: string, email: string, reason: string) {
    structuredLogger.audit({ level: event.endsWith("rejected") ? "warn" : "info", event, message: "Authentication event", emailHash: hashIdentifier(email), reason });
  }
}

export const authService = new AuthService();

export function configureAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(session({
    name: "fincoach.sid",
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    store: sessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production" && process.env.FINCOACH_AUTH_SECURE_COOKIE !== "false",
      maxAge: 1000 * 60 * 60 * 12,
    },
  }));
}

export function registerAuthRoutes(app: Express, service = authService) {
  app.get("/api/auth/session", async (req, res) => {
    const user = await service.currentUser(req.session.userId);
    if (!user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    req.session.csrfToken ??= randomBytes(24).toString("hex");
    res.json({ authenticated: true, user, csrfToken: req.session.csrfToken });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const result = await service.signup(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    if (!result.ok) {
      res.status(result.reason === "rate_limited" ? 429 : 403).json({ message: "Authentication failed" });
      return;
    }
    establishSession(req, result.user);
    res.status(201).json({ user: result.user, csrfToken: req.session.csrfToken });
  });

  app.post("/api/auth/signin", async (req, res) => {
    const result = await service.signin(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    if (!result.ok) {
      res.status(result.reason === "rate_limited" ? 429 : 401).json({ message: "Authentication failed" });
      return;
    }
    establishSession(req, result.user);
    res.json({ user: result.user, csrfToken: req.session.csrfToken });
  });

  app.post("/api/auth/signout", (req, res) => {
    req.session.destroy(() => res.json({ signedOut: true }));
  });
}

export function requireAuthenticatedRequest(req: Request, res: Response, next: NextFunction) {
  if (!authService.authRequired() || publicApi(req.originalUrl || req.path)) {
    next();
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (!safeCsrf(req)) {
    res.status(403).json({ message: "Invalid request token" });
    return;
  }
  next();
}

function establishSession(req: Request, user: PublicUser) {
  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.csrfToken = randomBytes(24).toString("hex");
}

function publicApi(path: string) {
  const pathname = path.split("?")[0];
  return pathname === "/api/health"
    || pathname.startsWith("/api/health/")
    || pathname === "/api/auth/session"
    || pathname === "/api/auth/signup"
    || pathname === "/api/auth/signin"
    || pathname === "/api/auth/signout"
    || pathname === "/api/telegram/webhook"
    || pathname === "/api/webhooks/tradingview";
}

function safeCsrf(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const token = req.get("x-fincoach-csrf-token");
  return Boolean(token && req.session.csrfToken && token === req.session.csrfToken);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validatePassword(password: string) {
  if (password.length < 12) return { ok: false as const, reason: "password_too_short" };
  return { ok: true as const };
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const iterations = DEFAULT_ITERATIONS;
  const hash = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST).toString("hex");
  return { salt, iterations, hash };
}

function verifyPassword(password: string, user: AuthUser) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = pbkdf2Sync(password, user.passwordSalt, user.passwordIterations, KEY_LENGTH, DIGEST);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function rateLimitOk(email: string) {
  const now = Date.now();
  const current = authAttempts.get(email);
  if (!current || current.resetAt < now) {
    authAttempts.set(email, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 5;
}

function createAuthRepository() {
  return process.env.DATABASE_URL ? new PgAuthRepository() : new InMemoryAuthRepository();
}

function sessionStore() {
  if (!process.env.DATABASE_URL) return undefined;
  return new PgAuthSessionStore(process.env.DATABASE_URL);
}

function sessionSecret() {
  const secret = process.env.FINCOACH_AUTH_SESSION_SECRET;
  if (secret?.trim()) return secret;
  if (process.env.NODE_ENV === "production" && process.env.FINCOACH_AUTH_ALLOW_EPHEMERAL_SECRET !== "true") {
    throw new Error("FINCOACH_AUTH_SESSION_SECRET is required in production");
  }
  return "fincoach-local-ephemeral-session-secret-change-me";
}

function publicUser(user: AuthUser): PublicUser {
  return { id: user.id, email: user.email };
}

function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    passwordSalt: String(row.password_salt),
    passwordIterations: Number(row.password_iterations),
    status: String(row.status) === "disabled" ? "disabled" : "active",
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null,
  };
}

class PgAuthSessionStore extends session.Store {
  private readonly pool: Pool;
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(databaseUrl: string) {
    super();
    this.pool = new Pool({ connectionString: databaseUrl });
    this.pool.on("error", (error) => this.logError("PG auth session pool error", error));
    this.pruneTimer = setInterval(() => void this.pruneExpired(), SESSION_PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
    void this.pruneExpired();
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void) {
    this.pool.query("SELECT sess FROM auth_sessions WHERE sid = $1 AND expire > now()", [sid])
      .then((result) => callback(null, result.rows[0]?.sess ?? null))
      .catch((error) => {
        this.logError("Failed to load auth session", error);
        callback(error);
      });
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void) {
    const expire = sessionExpiration(sess);
    this.pool.query(
      `INSERT INTO auth_sessions (sid, sess, expire)
       VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expire],
    ).then(() => callback?.())
      .catch((error) => {
        this.logError("Failed to save auth session", error);
        callback?.(error);
      });
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    this.pool.query("DELETE FROM auth_sessions WHERE sid = $1", [sid])
      .then(() => callback?.())
      .catch((error) => {
        this.logError("Failed to destroy auth session", error);
        callback?.(error);
      });
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void) {
    const expire = sessionExpiration(sess);
    this.pool.query("UPDATE auth_sessions SET expire = $2 WHERE sid = $1", [sid, expire])
      .then(() => callback?.())
      .catch((error) => {
        this.logError("Failed to touch auth session", error);
        callback?.();
      });
  }

  close() {
    clearInterval(this.pruneTimer);
    return this.pool.end();
  }

  private async pruneExpired() {
    try {
      await this.pool.query("DELETE FROM auth_sessions WHERE expire < now()");
    } catch (error) {
      this.logError("Failed to prune auth sessions", error);
    }
  }

  private logError(message: string, error: unknown) {
    structuredLogger.application({ level: "error", module: "auth", event: "auth_session_store_error", message, error });
  }
}

function sessionExpiration(sess: session.SessionData) {
  const expires = sess.cookie?.expires;
  if (expires instanceof Date) return expires;
  if (typeof expires === "string") {
    const parsed = new Date(expires);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date(Date.now() + SESSION_TTL_MS);
}

function hashIdentifier(value: string) {
  return pbkdf2Sync(value, "fincoach-auth-audit", 1, 12, DIGEST).toString("hex");
}
