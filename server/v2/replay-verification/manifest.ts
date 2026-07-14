import { createHash } from "crypto";
import { replayManifestSchema, type ReplayVerificationManifest } from "./contracts";

export function validateReplayManifest(input: unknown): ReplayVerificationManifest {
  return replayManifestSchema.parse(input);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashReplayManifest(manifest: ReplayVerificationManifest) {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

export function hashReplayDataset(events: readonly unknown[]) {
  return createHash("sha256").update(canonicalJson(events)).digest("hex");
}
