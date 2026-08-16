import { execFileSync } from "child_process";

export type DeploymentMetadata = {
  commit: string;
  buildId: string;
  source: string;
};

declare const __FINCOACH_BUILD_COMMIT__: string | undefined;
declare const __FINCOACH_BUILD_ID__: string | undefined;

const UNKNOWN = "unknown";

export function deploymentMetadata(env: NodeJS.ProcessEnv = process.env): DeploymentMetadata {
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
  const builtCommit = buildConstant("__FINCOACH_BUILD_COMMIT__", () => __FINCOACH_BUILD_COMMIT__);
  const builtId = buildConstant("__FINCOACH_BUILD_ID__", () => __FINCOACH_BUILD_ID__);
  const gitCommit = safeGitCommit();
  const commit = sanitizeIdentifier(commitSource?.value) ?? sanitizeIdentifier(builtCommit) ?? sanitizeIdentifier(gitCommit) ?? UNKNOWN;
  const buildId = sanitizeIdentifier(buildSource?.value) ?? sanitizeIdentifier(builtId) ?? sanitizeIdentifier(commitSource?.value) ?? sanitizeIdentifier(builtCommit) ?? sanitizeIdentifier(gitCommit) ?? UNKNOWN;
  return {
    commit,
    buildId,
    source: commitSource?.key ?? buildSource?.key ?? (builtCommit ? "build_metadata" : gitCommit ? "git" : "not_configured"),
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
