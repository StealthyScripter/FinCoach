import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export interface ReliabilityStateStore {
  get<T>(namespace: string, key: string): T | null;
  set<T>(namespace: string, key: string, value: T): void;
  delete(namespace: string, key: string): void;
  list<T>(namespace: string): T[];
  health(): { provider: "memory" | "json_file"; durable: boolean; records: number; location: string | null };
}

export class InMemoryReliabilityStateStore implements ReliabilityStateStore {
  protected records = new Map<string, unknown>();

  get<T>(namespace: string, key: string) {
    return (this.records.get(compound(namespace, key)) as T | undefined) ?? null;
  }

  set<T>(namespace: string, key: string, value: T) {
    this.records.set(compound(namespace, key), structuredClone(value));
  }

  delete(namespace: string, key: string) {
    this.records.delete(compound(namespace, key));
  }

  list<T>(namespace: string) {
    const prefix = `${namespace}:`;
    return Array.from(this.records.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value) as T);
  }

  health(): ReturnType<ReliabilityStateStore["health"]> {
    return { provider: "memory", durable: false, records: this.records.size, location: null };
  }
}

export class JsonFileReliabilityStateStore extends InMemoryReliabilityStateStore {
  private readonly file: string;

  constructor(file: string) {
    super();
    this.file = resolve(file);
    this.load();
  }

  override set<T>(namespace: string, key: string, value: T) {
    super.set(namespace, key, value);
    this.flush();
  }

  override delete(namespace: string, key: string) {
    super.delete(namespace, key);
    this.flush();
  }

  override health(): ReturnType<ReliabilityStateStore["health"]> {
    return { provider: "json_file", durable: true, records: this.records.size, location: this.file };
  }

  private load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      this.records = new Map(Object.entries(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private flush() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.records), null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
  }
}

function compound(namespace: string, key: string) {
  return `${namespace}:${key}`;
}

export const reliabilityStateStore: ReliabilityStateStore = process.env.MARKETPILOT_RELIABILITY_STATE_FILE
  ? new JsonFileReliabilityStateStore(process.env.MARKETPILOT_RELIABILITY_STATE_FILE)
  : new InMemoryReliabilityStateStore();
