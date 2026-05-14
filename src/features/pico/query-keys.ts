export function picoSessionScopeKey(sessionLike: {
  draft?: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
}) {
  if (sessionLike.draft) {
    return `draft:${sessionLike.cwd || ""}`
  }

  return sessionLike.sessionFile || sessionLike.sessionId || ""
}

export const picoQueryKeys = {
  directorySessionsIndex: (viewerContextId: string, directory: string) =>
    ["pico", "directory-sessions-index", viewerContextId, directory] as const,
  gitStatus: (viewerContextId: string, cwd: string) =>
    ["pico", "git-status", viewerContextId, cwd] as const,
  gitChanges: (viewerContextId: string, cwd: string) =>
    ["pico", "git-changes", viewerContextId, cwd] as const,
  gitFiles: (viewerContextId: string, cwd: string) =>
    ["pico", "git-files", viewerContextId, cwd] as const,
  gitFileDiffs: (viewerContextId: string, cwd: string) =>
    ["pico", "git-file-diffs", viewerContextId, cwd] as const,
  gitFileDiff: (viewerContextId: string, cwd: string, path: string) =>
    ["pico", "git-file-diffs", viewerContextId, cwd, path] as const,
  gitFileReviews: (viewerContextId: string, cwd: string) =>
    ["pico", "git-file-reviews", viewerContextId, cwd] as const,
  gitFileReview: (
    viewerContextId: string,
    cwd: string,
    path: string,
    previousPath = ""
  ) =>
    [
      "pico",
      "git-file-reviews",
      viewerContextId,
      cwd,
      path,
      previousPath,
    ] as const,
  gitBranches: (viewerContextId: string, cwd: string) =>
    ["pico", "git-branches", viewerContextId, cwd] as const,
  gitCommits: (viewerContextId: string, cwd: string) =>
    ["pico", "git-commits", viewerContextId, cwd] as const,
  gitCommitDiff: (
    viewerContextId: string,
    cwd: string,
    commit: string,
    mode: string,
    path = "",
    previousPath = ""
  ) =>
    [
      "pico",
      "git-commit-diff",
      viewerContextId,
      cwd,
      commit,
      mode,
      path,
      previousPath,
    ] as const,
  gitCommitFiles: (viewerContextId: string, cwd: string, commit: string) =>
    ["pico", "git-commit-files", viewerContextId, cwd, commit] as const,
  gitAction: (
    viewerContextId: string,
    cwd: string,
    action: "push" | "force-push" | "pull"
  ) => ["pico", "git-action", viewerContextId, cwd, action] as const,
  projectFileTree: (viewerContextId: string, cwd: string) =>
    ["pico", "project-file-tree", viewerContextId, cwd] as const,
  projectFileRead: (viewerContextId: string, cwd: string, path: string) =>
    ["pico", "project-file-read", viewerContextId, cwd, path] as const,
  sessionTree: (viewerContextId: string, sessionScopeKey: string) =>
    ["pico", "session-tree", viewerContextId, sessionScopeKey] as const,
  forkableMessages: (viewerContextId: string, sessionScopeKey: string) =>
    ["pico", "forkable-messages", viewerContextId, sessionScopeKey] as const,
  providerUsage: (
    viewerContextId: string,
    sessionId: string,
    provider: string,
    tokenRevision: number | null
  ) =>
    [
      "pico",
      "provider-usage",
      viewerContextId,
      sessionId,
      provider,
      tokenRevision,
    ] as const,
} as const
