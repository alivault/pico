export function picoAgentScopeKey(agentLike: {
  draft?: boolean
  agentFile?: string
  agentId?: string
  cwd?: string
}) {
  if (agentLike.draft) {
    return `draft:${agentLike.cwd || ""}`
  }

  return agentLike.agentFile || agentLike.agentId || ""
}

export const picoQueryKeys = {
  piPerformance: (viewerContextId: string) =>
    ["pico", "pi-performance", viewerContextId] as const,
  archivedAgents: (viewerContextId: string) =>
    ["pico", "archived-agents", viewerContextId] as const,
  directoryAgentsIndex: (viewerContextId: string, directory: string) =>
    ["pico", "directory-agents-index", viewerContextId, directory] as const,
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
  agentTree: (viewerContextId: string, agentScopeKey: string) =>
    ["pico", "agent-tree", viewerContextId, agentScopeKey] as const,
  forkableMessages: (viewerContextId: string, agentScopeKey: string) =>
    ["pico", "forkable-messages", viewerContextId, agentScopeKey] as const,
  providerUsage: (viewerContextId: string, agentId: string, provider: string) =>
    ["pico", "provider-usage", viewerContextId, agentId, provider] as const,
} as const
