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
  postgresToolSelection?: PostgresToolSelection;
};

export type PostgresToolSelection = {
  mode: "host" | "docker";
  container: string | null;
  serverMajor: number;
  clientMajor: number;
  clientVersion: string;
  dumpBin: string;
  restoreBin: string;
  dumpVersion: string;
  restoreVersion: string;
  explicit: boolean;
};

type CommandResult = Pick<ReturnType<typeof spawnSync>, "status" | "stdout" | "stderr">;
type CommandRunner = (command: string, args: string[], options?: Parameters<typeof spawnSync>[2]) => CommandResult;

type ToolResolutionOptions = {
  env?: NodeJS.ProcessEnv;
  runCommand?: CommandRunner;
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

  const list = pgRestoreListWithPolicy(backupPath, options.postgresToolSelection);
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

export async function resolvePostgresTools(databaseUrl: string, queryServerVersion: () => Promise<number>, options: ToolResolutionOptions = {}): Promise<PostgresToolSelection> {
  const serverMajor = Math.floor((await queryServerVersion()) / 10000);
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? runSpawn;
  const explicitDump = clean(env.FINCOACH_PG_DUMP_BIN);
  const explicitRestore = clean(env.FINCOACH_PG_RESTORE_BIN);
  const explicitDocker = clean(env.FINCOACH_POSTGRES_CONTAINER);
  const toolMode = clean(env.FINCOACH_POSTGRES_TOOL_MODE);
  if (explicitDump || explicitRestore) {
    return hostSelection({
      dumpBin: explicitDump ?? "pg_dump",
      restoreBin: explicitRestore ?? "pg_restore",
      serverMajor,
      explicit: true,
      runCommand,
      olderMessage: "configured PostgreSQL client is older than server",
    });
  }
  if (toolMode === "docker" || explicitDocker) {
    const container = explicitDocker ?? detectHealthyPostgresContainer(runCommand);
    if (!container) throw new Error("Docker PostgreSQL client requested, but no PostgreSQL container was configured or detected");
    return dockerSelection({ container, serverMajor, explicit: true, runCommand });
  }
  const host = tryHostSelection({ dumpBin: "pg_dump", restoreBin: "pg_restore", serverMajor, explicit: false, runCommand });
  if (host.ok) return host.selection;
  const container = detectHealthyPostgresContainer(runCommand);
  if (container) return dockerSelection({ container, serverMajor, explicit: false, runCommand });
  if (host.error && /older than server/.test(host.error.message)) throw host.error;
  throw new Error("no suitable PostgreSQL client found; install a compatible host pg_dump/pg_restore or set FINCOACH_POSTGRES_CONTAINER");
}

function hostSelection(input: { dumpBin: string; restoreBin: string; serverMajor: number; explicit: boolean; runCommand: CommandRunner; olderMessage: string }): PostgresToolSelection {
  const dumpVersion = toolVersion(input.dumpBin, ["--version"], input.runCommand);
  const restoreVersion = toolVersion(input.restoreBin, ["--version"], input.runCommand);
  const dumpMajor = parsePgMajor(dumpVersion);
  const restoreMajor = parsePgMajor(restoreVersion);
  const clientMajor = Math.min(dumpMajor, restoreMajor);
  if (clientMajor < input.serverMajor) {
    throw new Error(`${input.olderMessage}: dump client ${dumpMajor}, restore client ${restoreMajor}, server ${input.serverMajor}; install PostgreSQL ${input.serverMajor} client tools or set FINCOACH_PG_DUMP_BIN/FINCOACH_PG_RESTORE_BIN`);
  }
  return { mode: "host", container: null, serverMajor: input.serverMajor, clientMajor, clientVersion: restoreVersion, dumpBin: input.dumpBin, restoreBin: input.restoreBin, dumpVersion, restoreVersion, explicit: input.explicit };
}

function tryHostSelection(input: { dumpBin: string; restoreBin: string; serverMajor: number; explicit: boolean; runCommand: CommandRunner }): { ok: true; selection: PostgresToolSelection } | { ok: false; error: Error | null } {
  try {
    return { ok: true, selection: hostSelection({ ...input, olderMessage: "host PostgreSQL client is older than server" }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function dockerSelection(input: { container: string; serverMajor: number; explicit: boolean; runCommand: CommandRunner }): PostgresToolSelection {
  const dumpVersion = toolVersion("docker", ["exec", input.container, "pg_dump", "--version"], input.runCommand);
  const restoreVersion = toolVersion("docker", ["exec", input.container, "pg_restore", "--version"], input.runCommand);
  const dumpMajor = parsePgMajor(dumpVersion);
  const restoreMajor = parsePgMajor(restoreVersion);
  const clientMajor = Math.min(dumpMajor, restoreMajor);
  if (clientMajor < input.serverMajor) throw new Error(`Docker PostgreSQL client is older than server: dump client ${dumpMajor}, restore client ${restoreMajor}, server ${input.serverMajor}`);
  return { mode: "docker", container: input.container, serverMajor: input.serverMajor, clientMajor, clientVersion: restoreVersion, dumpBin: "pg_dump", restoreBin: "pg_restore", dumpVersion, restoreVersion, explicit: input.explicit };
}

export function runPgDumpToFile(selection: PostgresToolSelection, databaseUrl: string, outputPath: string) {
  if (selection.mode === "docker") {
    const parsed = new URL(databaseUrl);
    const result = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${decodeURIComponent(parsed.password)}`, selection.container!, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "-h", "localhost", "-p", "5432", "-U", decodeURIComponent(parsed.username), "-d", parsed.pathname.replace(/^\//, "")], { encoding: "buffer" });
    if (result.status !== 0) throw new Error(`pg_dump failed: ${redactOutput(result.stderr.toString(), databaseUrl) || `exit ${result.status}`}`);
    writeFileSync(outputPath, result.stdout);
    return;
  }
  const dumpBin = selection.dumpBin || process.env.FINCOACH_PG_DUMP_BIN || "pg_dump";
  const result = spawnSync(dumpBin, ["--format=custom", "--no-owner", "--no-acl", "--file", outputPath, databaseUrl], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pg_dump failed: ${redactOutput(`${result.stderr ?? ""}${result.stdout ?? ""}`, databaseUrl) || `exit ${result.status}`}`);
}

export function pgRestoreListWithPolicy(path: string, selection?: PostgresToolSelection) {
  if (selection?.mode === "docker") {
    const result = spawnSync("docker", ["exec", "-i", selection.container!, "pg_restore", "--list"], { input: readFileSync(path), encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`pg_restore --list failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`);
    return result.stdout;
  }
  const restoreBin = selection?.restoreBin || process.env.FINCOACH_PG_RESTORE_BIN || "pg_restore";
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
  const restoreBin = selection.restoreBin || process.env.FINCOACH_PG_RESTORE_BIN || "pg_restore";
  const result = spawnSync(restoreBin, ["--no-owner", "--no-privileges", "--dbname", databaseUrl, backupPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pg_restore failed: ${redactOutput(`${result.stderr ?? ""}${result.stdout ?? ""}`, databaseUrl) || `exit ${result.status}`}`);
}

function detectHealthyPostgresContainer(runCommand: CommandRunner = runSpawn) {
  const ps = runCommand("docker", ["ps", "--format", "{{.Names}} {{.Image}} {{.Status}}"], { encoding: "utf8" });
  if (ps.status !== 0) return null;
  const rows = ps.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const match = rows.find((line) => /postgres/i.test(line) && /healthy/i.test(line)) ?? rows.find((line) => /postgres/i.test(line));
  return match?.split(/\s+/)[0] ?? null;
}

function toolVersion(command: string, args: string[], runCommand: CommandRunner = runSpawn) {
  const result = runCommand(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`unable to inspect PostgreSQL client version for ${command}`);
  return `${result.stdout}${result.stderr}`.trim();
}

function parsePgMajor(version: string) {
  const match = version.match(/(\d+)(?:\.\d+)?/);
  if (!match) throw new Error(`unable to parse PostgreSQL client version: ${version}`);
  return Number(match[1]);
}

function runSpawn(command: string, args: string[], options?: Parameters<typeof spawnSync>[2]) {
  return spawnSync(command, args, options);
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
