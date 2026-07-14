import { createHash } from "crypto";
import { createReadStream } from "fs";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashObject(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export async function hashFile(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on("data", chunk => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return hash.digest("hex");
}
