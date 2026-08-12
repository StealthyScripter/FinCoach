export function isAutomatedTestProcess(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv) {
  if (env.NODE_ENV === "test" || env.npm_lifecycle_event === "test") return true;
  return argv.some((value) => /\.test\.[cm]?[jt]sx?$/.test(value) || /marketpilot-execution\.test\.[cm]?[jt]sx?$/.test(value));
}
