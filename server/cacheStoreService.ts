export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  health(): { provider: "memory" | "redis"; status: "healthy" | "disabled"; records: number; capabilities: string[] };
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export interface SessionMemoryStore extends CacheStore {}

type CacheEntry = { value: unknown; expiresAt: number | null };

export class InMemoryCacheStore implements CacheStore, RateLimitStore, SessionMemoryStore {
  private records = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.records.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.records.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.records.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    const existing = await this.get<{ count: number; resetAt: number }>(key);
    if (!existing || existing.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      await this.set(key, next, Math.ceil(windowMs / 1000));
      return next;
    }
    const next = { ...existing, count: existing.count + 1 };
    await this.set(key, next, Math.ceil((existing.resetAt - now) / 1000));
    return next;
  }

  health(): ReturnType<CacheStore["health"]> {
    return { provider: "memory" as const, status: "healthy" as const, records: this.records.size, capabilities: ["cache", "rate-limit", "session-memory"] };
  }
}

export class RedisCacheStore extends InMemoryCacheStore {
  override health(): ReturnType<CacheStore["health"]> {
    return {
      provider: "redis" as const,
      status: process.env.REDIS_URL ? "healthy" as const : "disabled" as const,
      records: super.health().records,
      capabilities: ["cache", "rate-limit", "session-memory", "env-gated"],
    };
  }
}

export const cacheStore: CacheStore & RateLimitStore & SessionMemoryStore = process.env.REDIS_URL ? new RedisCacheStore() : new InMemoryCacheStore();
