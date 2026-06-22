export class SandboxExecutionMetrics {
  private accountSyncCount = 0;
  private sandboxOrderCount = 0;
  private sandboxFailureCount = 0;
  private lastAccountSyncAt: string | null = null;
  private lastOrderAt: string | null = null;
  private reconciliationCount = 0;
  private reconciliationFailureCount = 0;
  private lastReconciliationAt: string | null = null;
  private partialFillCount = 0;

  recordAccountSync(at = new Date()) {
    this.accountSyncCount += 1;
    this.lastAccountSyncAt = at.toISOString();
  }

  recordOrder(success: boolean, at = new Date()) {
    this.sandboxOrderCount += 1;
    if (!success) this.sandboxFailureCount += 1;
    this.lastOrderAt = at.toISOString();
  }

  recordReconciliation(matched: boolean, at = new Date()) {
    this.reconciliationCount += 1;
    if (!matched) this.reconciliationFailureCount += 1;
    this.lastReconciliationAt = at.toISOString();
  }

  recordPartialFill() {
    this.partialFillCount += 1;
  }

  snapshot() {
    return {
      accountSyncCount: this.accountSyncCount,
      sandboxOrderCount: this.sandboxOrderCount,
      sandboxFailureCount: this.sandboxFailureCount,
      lastAccountSyncAt: this.lastAccountSyncAt,
      lastOrderAt: this.lastOrderAt,
      reconciliationCount: this.reconciliationCount,
      reconciliationFailureCount: this.reconciliationFailureCount,
      lastReconciliationAt: this.lastReconciliationAt,
      partialFillCount: this.partialFillCount,
      productionOrderSubmissionCount: 0 as const,
    };
  }

  resetForTest() {
    this.accountSyncCount = 0;
    this.sandboxOrderCount = 0;
    this.sandboxFailureCount = 0;
    this.lastAccountSyncAt = null;
    this.lastOrderAt = null;
    this.reconciliationCount = 0;
    this.reconciliationFailureCount = 0;
    this.lastReconciliationAt = null;
    this.partialFillCount = 0;
  }
}

export const sandboxExecutionMetrics = new SandboxExecutionMetrics();
