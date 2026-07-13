import type { DurableLease, ReliabilityAuditRecord, ReliabilityDeadLetterRecord } from "./contracts";

export class InMemoryReliabilityRepository {
  readonly leases = new Map<string, DurableLease>();
  readonly providerFailures = new Map<string, number>();
  readonly providerBreakers = new Map<string, "closed" | "open">();
  readonly audit: ReliabilityAuditRecord[] = [];
  readonly deadLetters = new Map<string, ReliabilityDeadLetterRecord>();

  expireLeases(now: number) {
    const expired: DurableLease[] = [];
    for (const [name, lease] of this.leases) if (lease.expiresAt <= now) {
      expired.push(lease);
      this.leases.delete(name);
    }
    return expired;
  }
}
