export class MlSupportRepository {
  private readonly records: Record<string, unknown>[] = [];

  save(record: Record<string, unknown>) {
    this.records.push({ ...record });
    return record;
  }
}
