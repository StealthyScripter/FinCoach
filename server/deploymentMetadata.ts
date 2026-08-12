export type DeploymentMetadata = {
  commit: string;
  buildId: string;
  source: string;
};

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
  return {
    commit: sanitizeIdentifier(commitSource?.value) ?? UNKNOWN,
    buildId: sanitizeIdentifier(buildSource?.value) ?? sanitizeIdentifier(commitSource?.value) ?? UNKNOWN,
    source: commitSource?.key ?? buildSource?.key ?? "not_configured",
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
