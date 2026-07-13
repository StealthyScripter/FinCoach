import { createHash } from "crypto";
import type { ObservationEvidence } from "./contracts";

export function evidenceFingerprint(evidence: ObservationEvidence[]) {
  return createHash("sha256").update(JSON.stringify(evidence.map((item) => [item.sourceEventId, item.fact, item.value]).sort())).digest("hex");
}

export function evidence(sourceType: ObservationEvidence["sourceType"], sourceEventId: string, fact: string, value: unknown, observedAt: string): ObservationEvidence {
  return { evidenceId: evidenceFingerprint([{ evidenceId: "", sourceType, sourceEventId, fact, value, observedAt }]), sourceType, sourceEventId, fact, value, observedAt };
}

export function confidence(supporting: ObservationEvidence[], contradictory: ObservationEvidence[], quality = 1) {
  const raw = supporting.length / Math.max(1, supporting.length + contradictory.length);
  return Number(Math.max(0, Math.min(1, raw * quality)).toFixed(4));
}
