export function parameterGrid(grid: Record<string, Array<string | number | boolean>>) {
  const entries = Object.entries(grid);
  return entries.reduce<Record<string, string | number | boolean>[]>((acc, [key, values]) => acc.flatMap((item) => values.map((value) => ({ ...item, [key]: value }))), [{}]);
}
export function boundedRandom(grid: Record<string, Array<string | number | boolean>>, samples: number, seed: string) {
  const all = parameterGrid(grid);
  return all.sort((a, b) => JSON.stringify([seed, a]).localeCompare(JSON.stringify([seed, b]))).slice(0, Math.max(0, samples));
}
