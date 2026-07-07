import type { BacktestResult } from "./contracts";

export class BacktestRepository {
  private readonly results: BacktestResult[] = [];

  save(result: BacktestResult) {
    this.results.push(JSON.parse(JSON.stringify(result)) as BacktestResult);
    return result;
  }

  list() {
    return this.results.map((result) => JSON.parse(JSON.stringify(result)) as BacktestResult);
  }
}
