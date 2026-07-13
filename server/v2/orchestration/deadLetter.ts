import { createHash } from "crypto";
import type { DomainEvent } from "../contracts";
import type { OrchestrationDeadLetter, OrchestrationErrorCode } from "./contracts";

export function createDeadLetter(event: DomainEvent, reason: OrchestrationErrorCode, retryable: boolean): OrchestrationDeadLetter {
  return {
    deadLetterId: createHash("sha256").update(`${event.eventId}:${reason}`).digest("hex").slice(0, 32),
    sourceEventId: event.eventId,
    reason,
    createdAt: new Date().toISOString(),
    retryable,
    payload: { eventType: event.eventType, sourceModule: event.sourceModule },
  };
}
