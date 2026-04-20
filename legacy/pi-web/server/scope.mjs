export function normalizeSessionScope(rawScope, defaultCwd) {
  if (typeof rawScope !== "string") return defaultCwd
  const normalized = rawScope.trim()
  return normalized || defaultCwd
}

export function resolveScopeCwd(scope, defaultCwd) {
  return normalizeSessionScope(scope, defaultCwd) || defaultCwd
}
