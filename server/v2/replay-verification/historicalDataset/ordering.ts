import type { HistoricalReplayPartition, HistoricalReplayRecord } from "./contracts";

const priority: Record<HistoricalReplayRecord["recordType"], number> = {
  market_session: 0,
  candle: 10,
  economic_event: 20,
  corporate_event: 30,
  fundamental_publication: 40,
  revision: 50,
  late_arriving_correction: 60,
};

export function comparePartitions(a: HistoricalReplayPartition, b: HistoricalReplayPartition) {
  return a.startTimestamp.localeCompare(b.startTimestamp)
    || a.symbol.localeCompare(b.symbol)
    || a.timeframe.localeCompare(b.timeframe)
    || a.partitionId.localeCompare(b.partitionId);
}

export function compareHistoricalRecords(a: HistoricalReplayRecord, b: HistoricalReplayRecord) {
  return a.publicationTime.localeCompare(b.publicationTime)
    || a.effectiveTime.localeCompare(b.effectiveTime)
    || (priority[a.recordType] - priority[b.recordType])
    || (a.symbol ?? "").localeCompare(b.symbol ?? "")
    || (a.timeframe ?? "").localeCompare(b.timeframe ?? "")
    || a.sourceId.localeCompare(b.sourceId)
    || String(a.sourceSequence).localeCompare(String(b.sourceSequence))
    || a.recordId.localeCompare(b.recordId);
}
