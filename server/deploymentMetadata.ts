import { execFileSync } from "child_process";

export type DeploymentMetadata = {
  /** Authoritative revision for the code in the running artifact. */
  commit: string;
  /** Build identifier for the running artifact. */
  buildId: string;
  /** Source used for the authoritative commit field. */
  source: string;
  /** Commit embedded at build time, when available. */
  buildCommit: string;
  /** Runtime environment build id, exposed only for mismatch detection. */
  runtimeBuildId: string | null;
  /** Runtime environment commit, exposed only for mismatch detection. */
  runtimeCommit: string | null;
  /** Git worktree commit visible to the process, when available. */
  gitCommit: string | null;
  revisionMatch: boolean | null;
};

declare const __FINCOACH_BUILD_COMMIT__: string | undefined;
declare const __FINCOACH_BUILD_ID__: string | undefined;

const UNKNOWN = "unknown";

export function deploymentMetadata(env: NodeJS.ProcessEnv = process.env, embedded?: { buildCommit?: string; buildId?: string }): DeploymentMetadata {
  const commitSource = firstPresent(env, [
    "FINCOACH_BUILD_COMMIT",
    "RENDER_GIT_COMMIT",
    "GIT_COMMIT",
    "COMMIT_SHA",
    "SOURCE_VERSION",
    "VERCEL_GIT_COMMIT_SHA",
    "HEROKU_SLUG_COMMIT",
  ]);
  const buildSource = firstPresent(env, [
    "FINCOACH_BUILD_ID",
    "RENDER_SERVICE_ID",
    "BUILD_ID",
    "RELEASE_VERSION",
    "VERCEL_GIT_COMMIT_SHA",
    "HEROKU_RELEASE_VERSION",
  ]);
  const builtCommit = embedded?.buildCommit ?? buildConstant("__FINCOACH_BUILD_COMMIT__", () => __FINCOACH_BUILD_COMMIT__);
  const builtId = embedded?.buildId ?? buildConstant("__FINCOACH_BUILD_ID__", () => __FINCOACH_BUILD_ID__);
  const gitCommit = safeGitCommit();
  const sanitizedBuiltCommit = sanitizeIdentifier(builtCommit);
  const sanitizedBuiltId = sanitizeIdentifier(builtId);
  const sanitizedRuntimeCommit = sanitizeIdentifier(commitSource?.value);
  const sanitizedRuntimeBuildId = sanitizeIdentifier(buildSource?.value);
  const sanitizedGitCommit = sanitizeIdentifier(gitCommit);
  const commit = sanitizedBuiltCommit ?? sanitizedRuntimeCommit ?? sanitizedGitCommit ?? UNKNOWN;
  const buildId = sanitizedBuiltId ?? sanitizedRuntimeBuildId ?? commit;
  const revisionMatch = sanitizedRuntimeCommit && commit !== UNKNOWN ? sanitizedRuntimeCommit === commit : null;
  return {
    commit,
    buildId,
    source: sanitizedBuiltCommit ? "build_metadata" : sanitizedRuntimeCommit ? commitSource!.key : sanitizedGitCommit ? "git" : "not_configured",
    buildCommit: sanitizedBuiltCommit ?? UNKNOWN,
    runtimeBuildId: sanitizedRuntimeBuildId,
    runtimeCommit: sanitizedRuntimeCommit,
    gitCommit: sanitizedGitCommit,
    revisionMatch,
  };
}

function firstPresent(env: NodeJS.ProcessEnv, keys: string[]) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

function sanitizeIdentifier(value: string | undefined) {
  if (!value) return null;
  const safe = value.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128);
  return safe || null;
}

function buildConstant(_name: string, read: () => string | undefined) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safeGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}
