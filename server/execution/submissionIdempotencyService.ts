import { createHash } from "crypto";
import { SandboxBrokerError } from "./brokerFailures";
import { reliabilityStateStore, type ReliabilityStateStore } from "./reliabilityStateStore";

export type IdempotencyRecord<T> = {
  key: string;
  fingerprint: string;
  status: "in_flight" | "in_doubt" | "completed";
  result: T | null;
  createdAt: string;
  completedAt: string | null;
  replayCount: number;
};

export class SubmissionIdempotencyService<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(private readonly store: ReliabilityStateStore = reliabilityStateStore) {}

  async execute(key: string, fingerprintInput: unknown, operation: () => Promise<T>, now = new Date()) {
    const normalizedKey = key.trim();
    if (!normalizedKey) throw new SandboxBrokerError("order_rejected", "Idempotency key is required.");
    const fingerprint = hash(fingerprintInput);
    const existing = this.store.get<IdempotencyRecord<T>>("submission_idempotency", normalizedKey);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new SandboxBrokerError("order_rejected", "Idempotency key was already used for a different submission.");
    }
    if (existing?.status === "in_doubt" || existing?.status === "in_flight" && !this.inFlight.has(normalizedKey)) {
      if (existing.status === "in_flight") {
        existing.status = "in_doubt";
        this.store.set("submission_idempotency", normalizedKey, existing);
      }
      throw new SandboxBrokerError(
        "order_rejected",
        "The prior submission outcome is unknown. Reconcile broker state before resolving this idempotency key.",
      );
    }
    if (existing?.status === "completed" && existing.result !== null) {
      existing.replayCount += 1;
      this.store.set("submission_idempotency", normalizedKey, existing);
      return { result: existing.result, replayed: true, record: clone(existing) };
    }
    const pending = this.inFlight.get(normalizedKey);
    if (pending) {
      const result = await pending;
      const record = this.store.get<IdempotencyRecord<T>>("submission_idempotency", normalizedKey)!;
      record.replayCount += 1;
      this.store.set("submission_idempotency", normalizedKey, record);
      return { result, replayed: true, record: clone(record) };
    }

    const record: IdempotencyRecord<T> = {
      key: normalizedKey,
      fingerprint,
      status: "in_flight",
      result: null,
      createdAt: now.toISOString(),
      completedAt: null,
      replayCount: 0,
    };
    this.store.set("submission_idempotency", normalizedKey, record);
    const promise = operation();
    this.inFlight.set(normalizedKey, promise);
    try {
      const result = await promise;
      record.status = "completed";
      record.result = result;
      record.completedAt = new Date().toISOString();
      this.store.set("submission_idempotency", normalizedKey, record);
      return { result, replayed: false, record: clone(record) };
    } catch (error) {
      if (isAmbiguousSubmissionFailure(error)) {
        record.status = "in_doubt";
        record.completedAt = new Date().toISOString();
        this.store.set("submission_idempotency", normalizedKey, record);
      } else {
        this.store.delete("submission_idempotency", normalizedKey);
      }
      throw error;
    } finally {
      this.inFlight.delete(normalizedKey);
    }
  }

  list() {
    return this.store.list<IdempotencyRecord<T>>("submission_idempotency").map(clone);
  }

  resolveInDoubt(key: string, resolution: { result?: T; allowRetry?: boolean }, now = new Date()) {
    const record = this.store.get<IdempotencyRecord<T>>("submission_idempotency", key);
    if (!record || record.status !== "in_doubt") throw new Error("Idempotency record is not in doubt");
    if (resolution.result !== undefined) {
      record.status = "completed";
      record.result = resolution.result;
      record.completedAt = now.toISOString();
      this.store.set("submission_idempotency", key, record);
      return clone(record);
    }
    if (resolution.allowRetry) {
      this.store.delete("submission_idempotency", key);
      return null;
    }
    throw new Error("A recorded result or explicit retry authorization is required");
  }
}

function isAmbiguousSubmissionFailure(error: unknown) {
  return error instanceof SandboxBrokerError
    && (error.code === "provider_disconnected" || error.code === "rate_limited");
}

function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(input))).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function clone<T>(record: IdempotencyRecord<T>): IdempotencyRecord<T> {
  return { ...record };
}
