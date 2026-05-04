export function phiSessionScopeKey(sessionLike: {
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

export const phiQueryKeys = {
  directorySessionsIndex: (viewerContextId: string, directory: string) =>
    ["phi", "directory-sessions-index", viewerContextId, directory] as const,
  gitStatus: (viewerContextId: string, cwd: string) =>
    ["phi", "git-status", viewerContextId, cwd] as const,
  gitChanges: (viewerContextId: string, cwd: string) =>
    ["phi", "git-changes", viewerContextId, cwd] as const,
  gitFiles: (viewerContextId: string, cwd: string) =>
    ["phi", "git-files", viewerContextId, cwd] as const,
  gitFileDiffs: (viewerContextId: string, cwd: string) =>
    ["phi", "git-file-diffs", viewerContextId, cwd] as const,
  gitFileDiff: (viewerContextId: string, cwd: string, path: string) =>
    ["phi", "git-file-diffs", viewerContextId, cwd, path] as const,
  gitFileReviews: (viewerContextId: string, cwd: string) =>
    ["phi", "git-file-reviews", viewerContextId, cwd] as const,
  gitFileReview: (
    viewerContextId: string,
    cwd: string,
    path: string,
    previousPath = ""
  ) =>
    [
      "phi",
      "git-file-reviews",
      viewerContextId,
      cwd,
      path,
      previousPath,
    ] as const,
  gitBranches: (viewerContextId: string, cwd: string) =>
    ["phi", "git-branches", viewerContextId, cwd] as const,
  gitCommits: (viewerContextId: string, cwd: string) =>
    ["phi", "git-commits", viewerContextId, cwd] as const,
  gitAction: (
    viewerContextId: string,
    cwd: string,
    action: "push" | "force-push" | "pull"
  ) => ["phi", "git-action", viewerContextId, cwd, action] as const,
  projectFileTree: (viewerContextId: string, cwd: string) =>
    ["phi", "project-file-tree", viewerContextId, cwd] as const,
  projectFileRead: (viewerContextId: string, cwd: string, path: string) =>
    ["phi", "project-file-read", viewerContextId, cwd, path] as const,
  sessionTree: (viewerContextId: string, sessionScopeKey: string) =>
    ["phi", "session-tree", viewerContextId, sessionScopeKey] as const,
  forkableMessages: (viewerContextId: string, sessionScopeKey: string) =>
    ["phi", "forkable-messages", viewerContextId, sessionScopeKey] as const,
} as const
