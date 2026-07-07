import type { ValidationResult } from "./contracts";

export class ValidationRepository {
  private readonly results: ValidationResult[] = [];

  save(result: ValidationResult) {
    this.results.push(JSON.parse(JSON.stringify(result)) as ValidationResult);
    return result;
  }
}
