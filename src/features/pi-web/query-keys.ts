export function piWebSessionScopeKey(sessionLike: {
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

export const piWebQueryKeys = {
  directorySessionsIndex: (viewerContextId: string, directory: string) =>
    ["pi-web", "directory-sessions-index", viewerContextId, directory] as const,
  gitStatus: (viewerContextId: string, cwd: string) =>
    ["pi-web", "git-status", viewerContextId, cwd] as const,
  gitChanges: (viewerContextId: string, cwd: string) =>
    ["pi-web", "git-changes", viewerContextId, cwd] as const,
  sessionTree: (viewerContextId: string, sessionScopeKey: string) =>
    ["pi-web", "session-tree", viewerContextId, sessionScopeKey] as const,
  forkableMessages: (viewerContextId: string, sessionScopeKey: string) =>
    ["pi-web", "forkable-messages", viewerContextId, sessionScopeKey] as const,
} as const
