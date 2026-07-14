import type { V2DailyResearchReport } from "./contracts";

export type DailyReportRecord = {
  report: V2DailyResearchReport;
  status: "created" | "degraded" | "failed";
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DailyReportDeliveryStatus = "pending" | "delivered" | "failed" | "ambiguous";

export type DailyReportDeliveryRecord = {
  deliveryId: string;
  reportId: string;
  destination: string;
  deliveryAttempt: number;
  idempotencyKey: string;
  status: DailyReportDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class InMemoryV2OperationsRepository {
  private readonly reports = new Map<string, DailyReportRecord>();
  private readonly deliveries = new Map<string, DailyReportDeliveryRecord>();

  saveReport(record: DailyReportRecord) {
    const existing = this.reports.get(record.report.reportDate);
    if (existing) return { inserted: false, record: existing };
    this.reports.set(record.report.reportDate, freezeRecord(record));
    return { inserted: true, record };
  }

  getReportByDate(reportDate: string) {
    return this.reports.get(reportDate) ?? null;
  }

  latestReport() {
    return [...this.reports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.report.reportId.localeCompare(a.report.reportId))[0] ?? null;
  }

  saveDelivery(record: DailyReportDeliveryRecord) {
    const existing = this.deliveries.get(record.idempotencyKey);
    if (existing) return { inserted: false, record: existing };
    this.deliveries.set(record.idempotencyKey, freezeRecord(record));
    return { inserted: true, record };
  }

  deliveriesForReport(reportId: string) {
    return [...this.deliveries.values()].filter(delivery => delivery.reportId === reportId).sort((a, b) => a.deliveryAttempt - b.deliveryAttempt || a.destination.localeCompare(b.destination));
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
