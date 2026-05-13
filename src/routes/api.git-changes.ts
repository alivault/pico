import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import {
  readDirectoryGitBranches,
  readDirectoryGitChanges,
  readDirectoryGitCommits,
  readDirectoryGitFiles,
} from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

type GitChangesScope = "all" | "files" | "branches" | "commits"

const GIT_CHANGES_SCOPES = new Set<string>([
  "all",
  "files",
  "branches",
  "commits",
])

function isGitChangesScope(value: string | null): value is GitChangesScope {
  return Boolean(value && GIT_CHANGES_SCOPES.has(value))
}

function getGitChangesScope(url: URL): GitChangesScope {
  const gitScope = url.searchParams.get("gitScope")
  if (isGitChangesScope(gitScope)) return gitScope

  const legacyScope = url.searchParams.get("scope")
  return isGitChangesScope(legacyScope) ? legacyScope : "all"
}

function getRuntimeRequestForGitChanges(request: Request, url: URL) {
  const legacyScope = url.searchParams.get("scope")
  if (url.searchParams.has("gitScope") || !isGitChangesScope(legacyScope)) {
    return request
  }

  // Older clients used `scope` for the git subsection. The runtime also uses
  // `scope` as the session cwd, so strip the legacy git value before resolving
  // app context to avoid creating/activating sessions in cwd names like
  // "commits".
  const runtimeUrl = new URL(url)
  runtimeUrl.searchParams.delete("scope")
  return new Request(runtimeUrl.toString(), {
    headers: request.headers,
    method: request.method,
  })
}

export const Route = createFileRoute("/api/git-changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        const gitScope = getGitChangesScope(url)
        const commitsLimitValue = url.searchParams.get("commitsLimit")
        const commitsLimitParam = Number(commitsLimitValue)
        const commitsLimit =
          commitsLimitValue !== null && Number.isFinite(commitsLimitParam)
            ? commitsLimitParam
            : undefined
        if (!requestedCwd.trim()) {
          return errorResponse("cwd is required")
        }

        try {
          const runtimeRequest = getRuntimeRequestForGitChanges(request, url)
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(runtimeRequest)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          if (gitScope === "files") {
            const files = await readDirectoryGitFiles(cwd)
            return jsonResponse({
              ok: true,
              cwd,
              files: Array.isArray(files) ? files : files === null ? null : [],
              localBranches: [],
              remoteBranches: [],
              commits: [],
              commitsHasMore: false,
              commitsLimit: 0,
              unpushedCommitHashes: [],
            })
          }

          if (gitScope === "branches") {
            const branches = await readDirectoryGitBranches(cwd)
            return jsonResponse({
              ok: true,
              cwd,
              files: [],
              localBranches: Array.isArray(branches?.localBranches)
                ? branches.localBranches
                : branches === null
                  ? null
                  : [],
              remoteBranches: Array.isArray(branches?.remoteBranches)
                ? branches.remoteBranches
                : branches === null
                  ? null
                  : [],
              commits: [],
              commitsHasMore: false,
              commitsLimit: 0,
              unpushedCommitHashes: [],
            })
          }

          if (gitScope === "commits") {
            const commits = await readDirectoryGitCommits(cwd, {
              limit: commitsLimit,
            })
            return jsonResponse({
              ok: true,
              cwd,
              files: [],
              localBranches: [],
              remoteBranches: [],
              commits: Array.isArray(commits?.commits)
                ? commits.commits
                : commits === null
                  ? null
                  : [],
              commitsHasMore: Boolean(commits?.commitsHasMore),
              commitsLimit: commits?.commitsLimit ?? 0,
              unpushedCommitHashes: Array.isArray(commits?.unpushedCommitHashes)
                ? commits.unpushedCommitHashes
                : commits === null
                  ? null
                  : [],
            })
          }

          const gitChanges = await readDirectoryGitChanges(cwd)
          return jsonResponse({
            ok: true,
            cwd,
            files: Array.isArray(gitChanges?.files)
              ? gitChanges.files
              : gitChanges === null
                ? null
                : [],
            localBranches: Array.isArray(gitChanges?.localBranches)
              ? gitChanges.localBranches
              : gitChanges === null
                ? null
                : [],
            remoteBranches: Array.isArray(gitChanges?.remoteBranches)
              ? gitChanges.remoteBranches
              : gitChanges === null
                ? null
                : [],
            commits: Array.isArray(gitChanges?.commits)
              ? gitChanges.commits
              : gitChanges === null
                ? null
                : [],
            commitsHasMore: Boolean(gitChanges?.commitsHasMore),
            commitsLimit: gitChanges?.commitsLimit ?? 0,
            unpushedCommitHashes: Array.isArray(
              gitChanges?.unpushedCommitHashes
            )
              ? gitChanges.unpushedCommitHashes
              : gitChanges === null
                ? null
                : [],
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to read git changes")
        }
      },
    },
  },
})
