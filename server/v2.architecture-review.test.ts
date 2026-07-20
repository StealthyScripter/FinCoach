import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = process.cwd();
const v2Root = join(root, "server/v2");
const files = walk(v2Root).filter(file => file.endsWith(".ts"));
const productionFiles = files.filter(file => !file.endsWith(".test.ts") && !file.endsWith(".pg.test.ts"));
const moduleNames = new Set(readdirSync(v2Root).filter(name => statSync(join(v2Root, name)).isDirectory()));

assertNoCrossModuleConcreteRepositoryImports();
assertNoDirectSqlOutsideRepositories();
assertUniqueV2EventNames();
assertNoResearchBrokerOrTelegramImports();
assertNoDirectSecretEnvironmentAccess();
assertNoCircularImports();

console.log("v2 architecture review tests passed");

function assertNoCrossModuleConcreteRepositoryImports() {
  const violations: string[] = [];
  for (const file of productionFiles) {
    if (rel(file) === "server/v2/runtime/composition.ts") continue;
    const callerModule = moduleNameFor(file);
    if (!callerModule) continue;
    for (const imported of importsFrom(file)) {
      const resolved = resolveImport(file, imported);
      if (!resolved?.startsWith(v2Root)) continue;
      const targetModule = moduleNameFor(resolved);
      if (!targetModule || targetModule === callerModule) continue;
      if (/\/(pgRepository|repository)$/.test(stripExtension(relative(v2Root, resolved)))) {
        violations.push(`${rel(file)} imports concrete peer repository ${imported}`);
      }
    }
  }
  assert.deepEqual(violations, []);
}

function assertNoDirectSqlOutsideRepositories() {
  const violations = productionFiles
    .filter(file => !/(^|\/)(pgRepository|repository|evidenceRepository)\.ts$/.test(relative(v2Root, file)))
    .flatMap(file => {
      const matches = readFileSync(file, "utf8").match(/\b(SELECT|INSERT|UPDATE|DELETE)\s+/g) ?? [];
      return matches.map(match => `${rel(file)} contains ${match.trim()}`);
    });
  assert.deepEqual(violations, []);
}

function assertUniqueV2EventNames() {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const file of productionFiles.filter(file => file.endsWith("/events.ts"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/:\s*"([^"]+)"/g)) {
      const eventName = match[1]!;
      const existing = seen.get(eventName);
      if (existing) duplicates.push(`${eventName}: ${existing} and ${rel(file)}`);
      seen.set(eventName, rel(file));
    }
  }
  assert.deepEqual(duplicates, []);
}

function assertNoResearchBrokerOrTelegramImports() {
  const violations: string[] = [];
  for (const file of productionFiles) {
    const moduleName = moduleNameFor(file);
    if (!moduleName || ["operations", "governance", "reliability", "dataset-pipeline"].includes(moduleName)) continue;
    const text = readFileSync(file, "utf8");
    if (/(api-fxtrade|placeOrder\s*\(|submitOrder\s*\(|createOrder\s*\(|from\s+["'][^"']*telegram|telegramClient\s*\.|sendOperations\s*\()/i.test(text)) {
      violations.push(rel(file));
    }
  }
  assert.deepEqual(violations, []);
}

function assertNoDirectSecretEnvironmentAccess() {
  const violations = productionFiles.filter(file => /process\.env\.(OANDA_API_TOKEN|TELEGRAM_BOT_TOKEN)/.test(readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(violations, []);
}

function assertNoCircularImports() {
  const graph = new Map<string, string[]>();
  for (const file of productionFiles) {
    graph.set(file, importsFrom(file).map(imported => resolveImport(file, imported)).filter((resolved): resolved is string => Boolean(resolved?.startsWith(v2Root))));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[] = [];
  const visit = (file: string, stack: string[]) => {
    if (visiting.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(rel).join(" -> "));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...stack, next]);
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file, [file]);
  assert.deepEqual([...new Set(cycles)], []);
}

function importsFrom(file: string) {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g)].map(match => match[1]!).filter(value => value.startsWith("."));
}

function resolveImport(fromFile: string, imported: string) {
  const base = normalize(join(dirname(fromFile), imported));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

function moduleNameFor(file: string) {
  const parts = relative(v2Root, file).split("/");
  return moduleNames.has(parts[0] ?? "") ? parts[0] : null;
}

function stripExtension(path: string) {
  return path.replace(/\.ts$/, "");
}

function rel(file: string) {
  return relative(root, file);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
