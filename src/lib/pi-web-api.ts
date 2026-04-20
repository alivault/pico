export type ApiErrorResponse = {
  ok: false
  error: string
  routePath?: string
}

export type CompletionItem = {
  value: string
  label: string
  description?: string
  isDirectory: boolean
}

export type DirectoryResolveResponse =
  | {
      ok: true
      path: string
    }
  | ApiErrorResponse

export type PathCompletionsResponse =
  | {
      ok: true
      prefix: string
      totalCount: number
      items: Array<CompletionItem>
    }
  | ApiErrorResponse

export type FileCompletionsResponse =
  | {
      ok: true
      query: string
      totalCount: number
      items: Array<CompletionItem>
    }
  | ApiErrorResponse

export type GitStatusSummary = {
  branch?: string
  detached: boolean
  revision?: string
  dirty: boolean
  ahead: number
  behind: number
  inline: string
  label: string
  title: string
}

export type GitStatusResponse =
  | {
      ok: true
      cwd: string
      gitStatus: GitStatusSummary | null
    }
  | ApiErrorResponse

export type GitChangeFile = {
  status: string
  path: string
  previousPath?: string
  linesAdded?: number
  linesDeleted?: number
}

export type GitLocalBranch = {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  upstreamGone: boolean
  hash?: string
  subject?: string
  relativeDate?: string
}

export type GitRemoteBranch = {
  name: string
  hash?: string
  subject?: string
  relativeDate?: string
}

export type GitChangesResponse =
  | {
      ok: true
      cwd: string
      files: Array<GitChangeFile> | null
      localBranches: Array<GitLocalBranch> | null
      remoteBranches: Array<GitRemoteBranch> | null
      commits: Array<string> | null
      unpushedCommitShortHashes: Array<string> | null
    }
  | ApiErrorResponse

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  )
}
