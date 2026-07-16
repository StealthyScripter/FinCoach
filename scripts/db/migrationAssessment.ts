import type { Client } from "pg";
import type { MigrationFile } from "./migrationSafety";

export type MigrationAssessmentState =
  | "unapplied"
  | "schema_equivalent_without_ledger"
  | "partially_present"
  | "incompatible"
  | "applied_and_recorded"
  | "checksum_mismatch";

export type MigrationAssessment = {
  migrationId: string;
  filename: string;
  checksum: string;
  state: MigrationAssessmentState;
  ledger: { present: boolean; status: string | null; checksum: string | null };
  expected: ParsedMigrationExpectation;
  evidence: Array<{ check: string; ok: boolean; detail: string }>;
};

export type ParsedMigrationExpectation = {
  tables: Array<{ name: string; columns: Array<{ name: string; type: string; notNull: boolean; hasDefault: boolean }>; primaryKeyColumns: string[]; uniqueColumnSets: string[][] }>;
  indexes: Array<{ name: string; table: string | null; unique: boolean }>;
};

type LedgerRow = { migration_id: string; checksum: string; status: string } | undefined;

export function parseMigrationExpectation(sql: string): ParsedMigrationExpectation {
  const tables: ParsedMigrationExpectation["tables"] = [];
  const indexes: ParsedMigrationExpectation["indexes"] = [];
  const tablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][\w]*)\s*\(([\s\S]*?)\);/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tablePattern.exec(sql))) {
    const name = tableMatch[1];
    const body = tableMatch[2];
    const columns: Array<{ name: string; type: string; notNull: boolean; hasDefault: boolean }> = [];
    const primaryKeyColumns: string[] = [];
    const uniqueColumnSets: string[][] = [];
    for (const part of splitSqlList(body)) {
      const trimmed = part.trim();
      const tablePk = trimmed.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (tablePk) {
        primaryKeyColumns.push(...tablePk[1].split(",").map((item) => cleanIdent(item)));
        continue;
      }
      const tableUnique = trimmed.match(/^UNIQUE\s*\(([^)]+)\)/i);
      if (tableUnique) {
        uniqueColumnSets.push(tableUnique[1].split(",").map((item) => cleanIdent(item)).sort());
        continue;
      }
      if (/^(CONSTRAINT|FOREIGN\s+KEY|CHECK)\b/i.test(trimmed)) continue;
      const column = trimmed.match(/^([A-Za-z_][\w]*)\s+(.+)$/s);
      if (!column) continue;
      const columnName = column[1];
      const definition = column[2].replace(/\s+/g, " ").trim();
      const type = definition.split(/\s+(?:PRIMARY|NOT|NULL|DEFAULT|UNIQUE|REFERENCES|CHECK)\b/i)[0].trim();
      columns.push({ name: columnName, type: normalizeSqlType(type), notNull: /\bNOT\s+NULL\b/i.test(definition) || /\bPRIMARY\s+KEY\b/i.test(definition), hasDefault: /\bDEFAULT\b/i.test(definition) });
      if (/\bPRIMARY\s+KEY\b/i.test(definition)) primaryKeyColumns.push(columnName);
      if (/\bUNIQUE\b/i.test(definition)) uniqueColumnSets.push([columnName]);
    }
    tables.push({ name, columns, primaryKeyColumns: [...new Set(primaryKeyColumns)], uniqueColumnSets });
  }
  const indexPattern = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w]*)/gi;
  let indexMatch: RegExpExecArray | null;
  while ((indexMatch = indexPattern.exec(sql))) {
    indexes.push({ name: indexMatch[2], table: indexMatch[3], unique: Boolean(indexMatch[1]) });
  }
  return { tables, indexes };
}

export async function assessMigrations(client: Client, migrations: MigrationFile[]): Promise<MigrationAssessment[]> {
  const ledger = await readLedgerIfPresent(client);
  const results: MigrationAssessment[] = [];
  for (const migration of migrations) {
    const expected = parseMigrationExpectation(migration.sql);
    const ledgerRow = ledger.get(migration.id);
    const evidence = await assessExpectation(client, expected);
    const anyPresent = evidence.some((item) => /present|exists/.test(item.check) && item.ok);
    const allOk = evidence.every((item) => item.ok);
    const ledgerInfo = { present: Boolean(ledgerRow), status: ledgerRow?.status ?? null, checksum: ledgerRow?.checksum ?? null };
    let state: MigrationAssessmentState;
    if (ledgerRow && ledgerRow.checksum !== migration.checksum) state = "checksum_mismatch";
    else if (ledgerRow && ledgerRow.status === "applied" && allOk) state = "applied_and_recorded";
    else if (ledgerRow && ledgerRow.status !== "applied") state = "partially_present";
    else if (!ledgerRow && expected.tables.length === 0 && expected.indexes.length === 0) state = "incompatible";
    else if (!ledgerRow && allOk) state = "schema_equivalent_without_ledger";
    else if (!ledgerRow && !anyPresent) state = "unapplied";
    else if (!ledgerRow && anyPresent) state = "partially_present";
    else state = "incompatible";
    results.push({ migrationId: migration.id, filename: migration.filename, checksum: migration.checksum, state, ledger: ledgerInfo, expected, evidence });
  }
  return results;
}

async function assessExpectation(client: Client, expected: ParsedMigrationExpectation) {
  const evidence: MigrationAssessment["evidence"] = [];
  for (const table of expected.tables) {
    const exists = await tableExists(client, table.name);
    evidence.push({ check: `table_present:${table.name}`, ok: exists, detail: exists ? "table exists" : "table missing" });
    if (!exists) continue;
    const columns = await tableColumns(client, table.name);
    for (const expectedColumn of table.columns) {
      const actual = columns.get(expectedColumn.name);
      if (!actual) {
        evidence.push({ check: `column_present:${table.name}.${expectedColumn.name}`, ok: false, detail: "column missing" });
        continue;
      }
      evidence.push({ check: `column_present:${table.name}.${expectedColumn.name}`, ok: true, detail: "column exists" });
      evidence.push({ check: `column_type:${table.name}.${expectedColumn.name}`, ok: typeCompatible(expectedColumn.type, actual.type), detail: `expected ${expectedColumn.type}, actual ${actual.type}` });
      evidence.push({ check: `column_nullability:${table.name}.${expectedColumn.name}`, ok: expectedColumn.notNull === actual.notNull, detail: `expected notNull=${expectedColumn.notNull}, actual notNull=${actual.notNull}` });
      if (expectedColumn.hasDefault) evidence.push({ check: `column_default:${table.name}.${expectedColumn.name}`, ok: actual.hasDefault, detail: actual.default ?? "missing default" });
    }
    if (table.primaryKeyColumns.length) {
      const actualPk = await primaryKeyColumns(client, table.name);
      evidence.push({ check: `primary_key:${table.name}`, ok: sameSet(table.primaryKeyColumns, actualPk), detail: `expected ${table.primaryKeyColumns.join(",")}, actual ${actualPk.join(",")}` });
    }
    for (const uniqueSet of table.uniqueColumnSets) {
      const ok = await uniqueConstraintExists(client, table.name, uniqueSet);
      evidence.push({ check: `unique:${table.name}:${uniqueSet.join(",")}`, ok, detail: ok ? "unique constraint/index exists" : "unique constraint/index missing" });
    }
  }
  for (const index of expected.indexes) {
    const ok = await indexExists(client, index.name);
    evidence.push({ check: `index_exists:${index.name}`, ok, detail: ok ? "index exists" : "index missing" });
  }
  return evidence;
}

async function readLedgerIfPresent(client: Client) {
  const exists = await client.query("SELECT to_regclass('fincoach_schema_migrations') AS ledger");
  const ledger = new Map<string, LedgerRow>();
  if (!exists.rows[0]?.ledger) return ledger;
  const rows = await client.query("SELECT migration_id, checksum, status FROM fincoach_schema_migrations ORDER BY migration_id");
  for (const row of rows.rows as Array<{ migration_id: string; checksum: string; status: string }>) ledger.set(row.migration_id, row);
  return ledger;
}

async function tableExists(client: Client, table: string) {
  const result = await client.query("SELECT to_regclass($1) AS name", [table]);
  return Boolean(result.rows[0]?.name);
}

async function tableColumns(client: Client, table: string) {
  const result = await client.query(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = $1
  `, [table]);
  const columns = new Map<string, { type: string; notNull: boolean; hasDefault: boolean; default: string | null }>();
  for (const row of result.rows) {
    columns.set(row.column_name, { type: normalizePgType(row.data_type, row.udt_name), notNull: row.is_nullable === "NO", hasDefault: row.column_default != null, default: row.column_default });
  }
  return columns;
}

async function primaryKeyColumns(client: Client, table: string) {
  const result = await client.query(`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE t.relname = $1 AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [table]);
  return result.rows.map((row) => row.column_name);
}

async function uniqueConstraintExists(client: Client, table: string, columns: string[]) {
  const result = await client.query(`
    SELECT array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum)) AS columns
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE t.relname = $1 AND i.indisunique
    GROUP BY i.indexrelid
  `, [table]);
  return result.rows.some((row) => sameSet(coercePgArray(row.columns), columns));
}

async function indexExists(client: Client, indexName: string) {
  const result = await client.query("SELECT to_regclass($1) AS name", [indexName]);
  return Boolean(result.rows[0]?.name);
}

function splitSqlList(input: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function cleanIdent(value: string) {
  return value.trim().replace(/^"|"$/g, "");
}

function normalizeSqlType(type: string) {
  return type.toLowerCase().replace(/\s+/g, " ").replace(/\bvarchar\b/, "character varying").replace(/\bjsonb\b/, "jsonb").trim();
}

function normalizePgType(dataType: string, udtName: string) {
  if (dataType === "USER-DEFINED") return udtName;
  return normalizeSqlType(dataType);
}

function typeCompatible(expected: string, actual: string) {
  const e = normalizeSqlType(expected);
  const a = normalizeSqlType(actual);
  if (e === a) return true;
  if (e === "text" && a === "text") return true;
  if (e === "timestamp" && a === "timestamp without time zone") return true;
  if (e === "timestamptz" && a === "timestamp with time zone") return true;
  if (e === "varchar" && a === "character varying") return true;
  return false;
}

function sameSet(left: string[], right: string[]) {
  return left.map(cleanIdent).sort().join("|") === right.map(cleanIdent).sort().join("|");
}

function coercePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  return [];
}
