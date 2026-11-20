export function smithAgentScopeKey(agentLike: {
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

export const smithQueryKeys = {
  piPerformance: (viewerContextId: string) =>
    ["smith", "pi-performance", viewerContextId] as const,
  archivedAgents: (viewerContextId: string) =>
    ["smith", "archived-agents", viewerContextId] as const,
  projectAgentsIndex: (viewerContextId: string, project: string) =>
    ["smith", "project-agents-index", viewerContextId, project] as const,
  gitStatus: (viewerContextId: string, cwd: string) =>
    ["smith", "git-status", viewerContextId, cwd] as const,
  gitChanges: (viewerContextId: string, cwd: string) =>
    ["smith", "git-changes", viewerContextId, cwd] as const,
  gitFiles: (viewerContextId: string, cwd: string) =>
    ["smith", "git-files", viewerContextId, cwd] as const,
  gitFileDiffs: (viewerContextId: string, cwd: string) =>
    ["smith", "git-file-diffs", viewerContextId, cwd] as const,
  gitFileDiff: (viewerContextId: string, cwd: string, path: string) =>
    ["smith", "git-file-diffs", viewerContextId, cwd, path] as const,
  gitFileReviews: (viewerContextId: string, cwd: string) =>
    ["smith", "git-file-reviews", viewerContextId, cwd] as const,
  gitFileReview: (
    viewerContextId: string,
    cwd: string,
    path: string,
    previousPath = ""
  ) =>
    [
      "smith",
      "git-file-reviews",
      viewerContextId,
      cwd,
      path,
      previousPath,
    ] as const,
  gitBranches: (viewerContextId: string, cwd: string) =>
    ["smith", "git-branches", viewerContextId, cwd] as const,
  gitCommits: (viewerContextId: string, cwd: string) =>
    ["smith", "git-commits", viewerContextId, cwd] as const,
  gitCommitDiff: (
    viewerContextId: string,
    cwd: string,
    commit: string,
    mode: string,
    path = "",
    previousPath = ""
  ) =>
    [
      "smith",
      "git-commit-diff",
      viewerContextId,
      cwd,
      commit,
      mode,
      path,
      previousPath,
    ] as const,
  ghRepo: (viewerContextId: string, cwd: string) =>
    ["smith", "gh-repo", viewerContextId, cwd] as const,
  ghLabels: (viewerContextId: string, cwd: string) =>
    ["smith", "gh-labels", viewerContextId, cwd] as const,
  ghIssues: (viewerContextId: string, cwd: string) =>
    ["smith", "gh-issues", viewerContextId, cwd] as const,
  ghIssueList: (
    viewerContextId: string,
    cwd: string,
    state: string,
    label: string,
    search: string
  ) =>
    [
      "smith",
      "gh-issues",
      viewerContextId,
      cwd,
      "list",
      state,
      label,
      search,
    ] as const,
  ghIssue: (viewerContextId: string, cwd: string, number: number) =>
    ["smith", "gh-issues", viewerContextId, cwd, "issue", number] as const,
  gitCommitFiles: (viewerContextId: string, cwd: string, commit: string) =>
    ["smith", "git-commit-files", viewerContextId, cwd, commit] as const,
  gitAction: (
    viewerContextId: string,
    cwd: string,
    action: "push" | "force-push" | "pull"
  ) => ["smith", "git-action", viewerContextId, cwd, action] as const,
  projectFileTree: (viewerContextId: string, cwd: string) =>
    ["smith", "project-file-tree", viewerContextId, cwd] as const,
  projectFileRead: (viewerContextId: string, cwd: string, path: string) =>
    ["smith", "project-file-read", viewerContextId, cwd, path] as const,
  agentTree: (viewerContextId: string, agentScopeKey: string) =>
    ["smith", "agent-tree", viewerContextId, agentScopeKey] as const,
  forkableMessages: (viewerContextId: string, agentScopeKey: string) =>
    ["smith", "forkable-messages", viewerContextId, agentScopeKey] as const,
  providerUsageAll: () => ["smith", "provider-usage"] as const,
  providerUsage: (viewerContextId: string, agentId: string, provider: string) =>
    ["smith", "provider-usage", viewerContextId, agentId, provider] as const,
} as const
