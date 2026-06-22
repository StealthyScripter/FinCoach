import { createHash, createHmac, randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditEntry, type ExecutionAuditLog } from "./riskControls";
import { governanceRepository, type GovernanceRepository } from "./governanceRepository";

export type AuditExportArtifact = {
  format: "marketpilot-audit-export-v1";
  id: string;
  generatedAt: string;
  generatedBy: string;
  previousArtifactDigest: string | null;
  eventChain: Array<Record<string, unknown>>;
  executionAuditChain: Array<Record<string, unknown>>;
  productionOrderSubmissionEnabled: false;
};

export type AuditExportRecord = {
  id: string;
  artifactDigest: string;
  previousArtifactDigest: string | null;
  signature: string | null;
  signatureAlgorithm: "hmac-sha256" | "unsigned-sha256";
  eventCount: number;
  auditEntryCount: number;
  storageLocation: string | null;
  archiveLocation: string | null;
  generatedBy: string;
  generatedAt: string;
};

export type AuditExportBundle = {
  record: AuditExportRecord;
  artifact: AuditExportArtifact | null;
  verification: ReturnType<AuditExportService["verify"]> | null;
};

export class AuditExportService {
  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly repository: GovernanceRepository = governanceRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async generate(generatedBy: string, now = new Date()) {
    if (!generatedBy.trim()) throw new Error("A named audit exporter is required");
    const previous = (await this.repository.listAuditExports<AuditExportRecord>())
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0] ?? null;
    const eventChain = chain((await this.events.durableList()).reverse());
    const executionAuditChain = chain(
      (await this.audit.durableList()).reverse().map((entry) => normalizeAudit(entry)),
    );
    const artifact: AuditExportArtifact = {
      format: "marketpilot-audit-export-v1",
      id: randomUUID(),
      generatedAt: now.toISOString(),
      generatedBy,
      previousArtifactDigest: previous?.artifactDigest ?? null,
      eventChain,
      executionAuditChain,
      productionOrderSubmissionEnabled: false,
    };
    const canonicalArtifact = canonical(artifact);
    const artifactDigest = sha256(canonicalArtifact);
    const signingKey = this.env.MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY;
    const signature = signingKey
      ? createHmac("sha256", signingKey).update(canonicalArtifact).digest("hex")
      : null;
    const storageLocation = this.writeArtifact(artifact, artifactDigest, signature);
    const archiveLocation = this.writeArchive(artifact, artifactDigest, signature);
    const record: AuditExportRecord = {
      id: artifact.id,
      artifactDigest,
      previousArtifactDigest: artifact.previousArtifactDigest,
      signature,
      signatureAlgorithm: signature ? "hmac-sha256" : "unsigned-sha256",
      eventCount: eventChain.length,
      auditEntryCount: executionAuditChain.length,
      storageLocation,
      archiveLocation,
      generatedBy,
      generatedAt: artifact.generatedAt,
    };
    await this.repository.saveAuditExport(record);
    this.events.append({
      type: "audit.export_generated",
      userId: generatedBy,
      sourceService: "audit-export",
      correlationId: artifact.id,
      payload: {
        artifactDigest,
        previousArtifactDigest: artifact.previousArtifactDigest,
        signatureAlgorithm: record.signatureAlgorithm,
        storageLocation,
        archiveLocation,
      },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "audit.export.generated",
      outcome: "created",
      correlationId: artifact.id,
      detail: record,
    });
    return { artifact, record };
  }

  verify(artifact: AuditExportArtifact, expectedDigest: string, signature: string | null) {
    const canonicalArtifact = canonical(artifact);
    const digestValid = sha256(canonicalArtifact) === expectedDigest;
    const key = this.env.MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY;
    const signatureValid = signature === null
      ? key === undefined
      : Boolean(key && createHmac("sha256", key).update(canonicalArtifact).digest("hex") === signature);
    return {
      valid: digestValid && signatureValid && verifyChain(artifact.eventChain) && verifyChain(artifact.executionAuditChain),
      digestValid,
      signatureValid,
      eventChainValid: verifyChain(artifact.eventChain),
      executionAuditChainValid: verifyChain(artifact.executionAuditChain),
    };
  }

  async list() {
    return (await this.repository.listAuditExports<AuditExportRecord>())
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  }

  async get(id: string): Promise<AuditExportBundle | null> {
    const record = (await this.list()).find((entry) => entry.id === id) ?? null;
    if (!record) return null;
    const artifact = (record.storageLocation ? this.readArtifact(record.storageLocation) : null)
      ?? (record.archiveLocation ? this.readArtifact(record.archiveLocation) : null);
    return {
      record,
      artifact,
      verification: artifact ? this.verify(artifact, record.artifactDigest, record.signature) : null,
    };
  }

  health() {
    return {
      repository: this.repository.health(),
      signingConfigured: Boolean(this.env.MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY),
      exportDirectoryConfigured: Boolean(this.env.MARKETPILOT_AUDIT_EXPORT_DIR),
      archiveDirectoryConfigured: Boolean(this.env.MARKETPILOT_AUDIT_ARCHIVE_DIR),
      sourcePersistence: {
        events: this.events.persistenceHealth(),
        executionAudit: this.audit.persistenceHealth(),
      },
      productionOrderSubmissionEnabled: false as const,
    };
  }

  private writeArtifact(artifact: AuditExportArtifact, digest: string, signature: string | null) {
    const directory = this.env.MARKETPILOT_AUDIT_EXPORT_DIR;
    if (!directory) return null;
    return this.writeReplica(directory, artifact, digest, signature);
  }

  private writeArchive(artifact: AuditExportArtifact, digest: string, signature: string | null) {
    const directory = this.env.MARKETPILOT_AUDIT_ARCHIVE_DIR;
    if (!directory) return null;
    return this.writeReplica(directory, artifact, digest, signature);
  }

  private writeReplica(directory: string, artifact: AuditExportArtifact, digest: string, signature: string | null) {
    const file = resolve(directory, `${artifact.generatedAt.replaceAll(":", "-")}-${artifact.id}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ artifact, digest, signature }, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
    return file;
  }

  private readArtifact(file: string): AuditExportArtifact | null {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { artifact?: AuditExportArtifact };
      return parsed.artifact ?? null;
    } catch {
      return null;
    }
  }
}

function chain(items: unknown[]) {
  let previousDigest: string | null = null;
  return items.map((item, index) => {
    const normalized = stable(item);
    const digest = sha256(canonical({ sequence: index + 1, previousDigest, item: normalized }));
    const chained = { sequence: index + 1, previousDigest, digest, item: normalized };
    previousDigest = digest;
    return chained;
  });
}

function verifyChain(items: Array<Record<string, unknown>>) {
  let previousDigest: string | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (entry.sequence !== index + 1 || entry.previousDigest !== previousDigest) return false;
    const expected = sha256(canonical({ sequence: index + 1, previousDigest, item: entry.item }));
    if (entry.digest !== expected) return false;
    previousDigest = String(entry.digest);
  }
  return true;
}

function normalizeAudit(entry: ExecutionAuditEntry) {
  return { ...entry, detail: stable(entry.detail) };
}

function canonical(value: unknown) {
  return JSON.stringify(stable(value));
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export const auditExportService = new AuditExportService();
