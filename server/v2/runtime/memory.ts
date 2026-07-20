import v8 from "v8";

let peakHeapUsedBytes = 0;

export function memorySnapshot(input: { eventLogItems?: number; evidenceCacheItems?: number; activeCycles?: number; activeTimers?: number } = {}) {
  const usage = process.memoryUsage();
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, usage.heapUsed);
  return {
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
    externalMemoryBytes: usage.external,
    rssBytes: usage.rss,
    peakHeapUsedBytes,
    eventLogItems: input.eventLogItems ?? 0,
    evidenceCacheItems: input.evidenceCacheItems ?? 0,
    activeCycles: input.activeCycles ?? 0,
    activeTimers: input.activeTimers ?? 0,
    activeHandles: typeof (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles === "function"
      ? (process as unknown as { _getActiveHandles: () => unknown[] })._getActiveHandles().length
      : null,
  };
}
