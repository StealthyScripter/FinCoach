import { z } from "zod";
import { domainEventSchema, type DomainEvent } from "../contracts/events";

export const lineageReferenceSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  schemaVersion: z.string().min(1),
  sourceModule: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export type LineageReference = z.infer<typeof lineageReferenceSchema>;

export function toLineageReference(event: DomainEvent): LineageReference {
  return lineageReferenceSchema.parse({
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    sourceModule: event.sourceModule,
    occurredAt: event.occurredAt,
  });
}

export function assertEventLineage(event: unknown, requiredCausation = false) {
  const parsed = domainEventSchema.parse(event);
  if (requiredCausation && parsed.causationId === null) {
    throw new Error("V2 event lineage requires causationId for derived events");
  }
  const refs = Array.isArray(parsed.metadata.lineage) ? parsed.metadata.lineage : [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsedRef = lineageReferenceSchema.parse(ref);
    if (seen.has(parsedRef.eventId)) throw new Error(`Duplicate lineage reference: ${parsedRef.eventId}`);
    if (parsedRef.eventId === parsed.eventId) throw new Error("Event cannot include itself in lineage");
    seen.add(parsedRef.eventId);
  }
  return true;
}
