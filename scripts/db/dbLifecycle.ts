import { createHash } from "crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import { execFileSync, spawnSync } from "child_process";

export type BackupEvidence = {
  backupId: string;
  path: string;
  checksum: string;
  checksumPath: string | null;
  sizeBytes: number;
  createdAt: string;
  verifiedAt: string;
  databaseIdentity: Record<string, unknown> | null;
  archiveCatalogEntries: number;
  repositoryCommit: string | null;
};

export type BackupVerificationOptions = {
  backupPath: string;
  checksumPath?: string | null;
  maxAgeHours?: number;
  requireOutsideRepository?: boolean;
  repositoryRoot?: string;
  mustPredate?: Date;
};

export type PostgresToolSelection = {
  mode: "host" | "docker";
  container: string | null;
  serverMajor: number;
  clientMajor: number;
  clientVersion: string;
};

export function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readChecksumFile(path: string) {
  const raw = readFileSync(path, "utf8").trim();
  const match = raw.match(/[a-f0-9]{64}/i);
  if (!match) throw new Error(`checksum file does not contain a SHA-256 digest: ${path}`);
  return match[0].toLowerCase();
}

export function assertBackupPathOutsideRepository(backupPath: string, repositoryRoot = process.cwd()) {
  const root = `${resolve(repositoryRoot)}/`;
  const resolved = resolve(backupPath);
  if (resolved === resolve(repositoryRoot) || resolved.startsWith(root)) {
    throw new Error("backup artifact must be outside the repository working tree");
  }
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", resolved], { cwd: repositoryRoot, encoding: "utf8" });
  if (tracked.status === 0) throw new Error("backup artifact must not be Git-tracked");
}

export function verifyBackupArtifact(options: BackupVerificationOptions): BackupEvidence {
  const backupPath = resolve(options.backupPath);
  if (!isAbsolute(backupPath)) throw new Error("backup path must resolve to an absolute path");
  if (!existsSync(backupPath)) throw new Error(`backup artifact missing: ${backupPath}`);
  const stat = statSync(backupPath);
  if (!stat.isFile()) throw new Error(`backup artifact is not a file: ${backupPath}`);
  if (stat.size <= 0) throw new Error(`backup artifact is empty: ${backupPath}`);
  if (options.requireOutsideRepository !== false) assertBackupPathOutsideRepository(backupPath, options.repositoryRoot);

  const actualChecksum = sha256File(backupPath);
  const checksumPath = options.checksumPath ? resolve(options.checksumPath) : `${backupPath}.sha256`;
  if (!existsSync(checksumPath)) throw new Error(`backup checksum file missing: ${checksumPath}`);
  const expectedChecksum = readChecksumFile(checksumPath);
  if (actualChecksum !== expectedChecksum) throw new Error("backup checksum mismatch");

  const list = pgRestoreListWithPolicy(backupPath);
  const entries = list.split("\n").filter((line) => line.trim() && !line.startsWith(";")).length;
  if (entries <= 0) throw new Error("backup archive catalog is empty");

  const maxAgeHours = options.maxAgeHours ?? Number(process.env.FINCOACH_DB_BACKUP_MAX_AGE_HOURS ?? "24");
  if (Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > maxAgeHours * 60 * 60 * 1000) throw new Error(`backup artifact is older than ${maxAgeHours} hours`);
  }
  if (options.mustPredate && stat.mtimeMs > options.mustPredate.getTime()) {
    throw new Error("backup artifact timestamp is after migration execution start");
  }

  return {
    backupId: backupIdFromPath(backupPath),
    path: backupPath,
    checksum: actualChecksum,
    checksumPath,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    verifiedAt: new Date().toISOString(),
    databaseIdentity: readSidecarIdentity(backupPath),
    archiveCatalogEntries: entries,
    repositoryCommit: currentCommit(),
  };
}

export function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function assertDisposableLocalDatabase(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is malformed");
  }
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, "").toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
  if (!localHosts.has(host)) throw new Error(`database host is not recognized as disposable/local: ${host}`);
  if (!/(test|tmp|temp|disposable|local)/.test(database)) throw new Error(`database name is not marked disposable/local: ${database}`);
}

export function assertDbPushAllowed(argv: string[], env: NodeJS.ProcessEnv) {
  if (env.FINCOACH_ALLOW_LOCAL_SCHEMA_PUSH !== "true") throw new Error("db:push is disabled by default; use tracked migrations");
  if (env.NODE_ENV === "production" || env.FINCOACH_ENV === "production" || env.FINCOACH_CLOUD_DEPLOYMENT === "true") {
    throw new Error("db:push is rejected in production/cloud environments");
  }
  if (!argv.includes("--i-understand-this-destroys-disposable-local-state")) {
    throw new Error("db:push requires --i-understand-this-destroys-disposable-local-state");
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for db:push guard");
  assertDisposableLocalDatabase(databaseUrl);
}

function backupIdFromPath(path: string) {
  return path.split("/").pop()?.replace(/\.dump$/, "") ?? "unknown";
}

function readSidecarIdentity(path: string) {
  const metadataPath = `${path}.metadata.json`;
  if (!existsSync(metadataPath)) return null;
  try {
    return JSON.parse(readFileSync(metadataPath, "utf8")).databaseIdentity ?? null;
  } catch {
    return null;
  }
}

export function pgRestoreList(path: string) {
  return execFileSync("pg_restore", ["--list", path], { encoding: "utf8" });
}

export async function resolvePostgresTools(databaseUrl: string, queryServerVersion: () => Promise<number>): Promise<PostgresToolSelection> {
  const serverMajor = Math.floor((await queryServerVersion()) / 10000);
  const explicitDump = process.env.FINCOACH_PG_DUMP_BIN;
  const explicitRestore = process.env.FINCOACH_PG_RESTORE_BIN;
  if (explicitDump && explicitRestore) {
    const version = toolVersion(explicitDump, ["--version"]);
    const clientMajor = parsePgMajor(version);
    if (clientMajor < serverMajor) throw new Error(`configured PostgreSQL client is older than server: client ${clientMajor}, server ${serverMajor}`);
    return { mode: "host", container: null, serverMajor, clientMajor, clientVersion: version };
  }
  const container = process.env.FINCOACH_POSTGRES_CONTAINER ?? detectHealthyPostgresContainer();
  if (container) {
    const version = toolVersion("docker", ["exec", container, "pg_dump", "--version"]);
    const clientMajor = parsePgMajor(version);
    if (clientMajor < serverMajor) throw new Error(`Docker PostgreSQL client is older than server: client ${clientMajor}, server ${serverMajor}`);
    return { mode: "docker", container, serverMajor, clientMajor, clientVersion: version };
  }
  const hostVersion = toolVersion(explicitDump ?? "pg_dump", ["--version"]);
  const hostMajor = parsePgMajor(hostVersion);
  if (hostMajor < serverMajor) throw new Error(`host PostgreSQL client is older than server: client ${hostMajor}, server ${serverMajor}; set FINCOACH_POSTGRES_CONTAINER or FINCOACH_PG_DUMP_BIN/FINCOACH_PG_RESTORE_BIN`);
  return { mode: "host", container: null, serverMajor, clientMajor: hostMajor, clientVersion: hostVersion };
}

export function runPgDumpToFile(selection: PostgresToolSelection, databaseUrl: string, outputPath: string) {
  if (selection.mode === "docker") {
    const parsed = new URL(databaseUrl);
    const result = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${decodeURIComponent(parsed.password)}`, selection.container!, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "-h", "localhost", "-p", "5432", "-U", decodeURIComponent(parsed.username), "-d", parsed.pathname.replace(/^\//, "")], { encoding: "buffer" });
    if (result.status !== 0) throw new Error(`pg_dump failed: ${redactOutput(result.stderr.toString(), databaseUrl) || `exit ${result.status}`}`);
    writeFileSync(outputPath, result.stdout);
    return;
  }
  const dumpBin = process.env.FINCOACH_PG_DUMP_BIN ?? "pg_dump";
  const result = spawnSync(dumpBin, ["--format=custom", "--no-owner", "--no-acl", "--file", outputPath, databaseUrl], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pg_dump failed: ${redactOutput(`${result.stderr ?? ""}${result.stdout ?? ""}`, databaseUrl) || `exit ${result.status}`}`);
}

export function pgRestoreListWithPolicy(path: string, selection?: PostgresToolSelection) {
  if (!selection && (process.env.FINCOACH_POSTGRES_CONTAINER || detectHealthyPostgresContainer())) {
    selection = { mode: "docker", container: process.env.FINCOACH_POSTGRES_CONTAINER ?? detectHealthyPostgresContainer(), serverMajor: 0, clientMajor: 0, clientVersion: "auto-detected docker pg_restore" };
  }
  if (selection?.mode === "docker") {
    const result = spawnSync("docker", ["exec", "-i", selection.container!, "pg_restore", "--list"], { input: readFileSync(path), encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`pg_restore --list failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`);
    return result.stdout;
  }
  const restoreBin = process.env.FINCOACH_PG_RESTORE_BIN ?? "pg_restore";
  const result = spawnSync(restoreBin, ["--list", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pg_restore --list failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`);
  return result.stdout;
}

export function runPgRestoreToDatabase(selection: PostgresToolSelection, databaseUrl: string, backupPath: string) {
  if (selection.mode === "docker") {
    const parsed = new URL(databaseUrl);
    const result = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${decodeURIComponent(parsed.password)}`, selection.container!, "pg_restore", "--no-owner", "--no-privileges", "-h", "localhost", "-p", "5432", "-U", decodeURIComponent(parsed.username), "-d", parsed.pathname.replace(/^\//, "")], { input: readFileSync(backupPath), encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`pg_restore failed: ${redactOutput(result.stderr.toString(), databaseUrl) || `exit ${result.status}`}`);
    return;
  }
  const restoreBin = process.env.FINCOACH_PG_RESTORE_BIN ?? "pg_restore";
  const result = spawnSync(restoreBin, ["--no-owner", "--no-privileges", "--dbname", databaseUrl, backupPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pg_restore failed: ${redactOutput(`${result.stderr ?? ""}${result.stdout ?? ""}`, databaseUrl) || `exit ${result.status}`}`);
}

function detectHealthyPostgresContainer() {
  const ps = spawnSync("docker", ["ps", "--format", "{{.Names}} {{.Image}} {{.Status}}"], { encoding: "utf8" });
  if (ps.status !== 0) return null;
  const rows = ps.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const match = rows.find((line) => /postgres/i.test(line) && /healthy/i.test(line)) ?? rows.find((line) => /postgres/i.test(line));
  return match?.split(/\s+/)[0] ?? null;
}

function toolVersion(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`unable to inspect PostgreSQL client version for ${command}`);
  return `${result.stdout}${result.stderr}`.trim();
}

function parsePgMajor(version: string) {
  const match = version.match(/(\d+)(?:\.\d+)?/);
  if (!match) throw new Error(`unable to parse PostgreSQL client version: ${version}`);
  return Number(match[1]);
}

function redactOutput(output: string, databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    return output.replaceAll(databaseUrl, redactUrl(databaseUrl)).replaceAll(url.password, "REDACTED");
  } catch {
    return output;
  }
}

function redactUrl(input: string) {
  const url = new URL(input);
  if (url.password) url.password = "REDACTED";
  if (url.username) url.username = "REDACTED";
  return url.toString();
}
