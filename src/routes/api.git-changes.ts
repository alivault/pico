import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import {
  readDirectoryGitBranches,
  readDirectoryGitChanges,
  readDirectoryGitCommits,
  readDirectoryGitFiles,
} from "@/server/git"
import { getPhiRuntime } from "@/server/phi-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        const scope = url.searchParams.get("scope") || "all"
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
          const { context, activeEntry } =
            await getPhiRuntime().resolveRequest(request)
          const baseCwd = getPhiRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          if (scope === "files") {
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
              unpushedCommitShortHashes: [],
            })
          }

          if (scope === "branches") {
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
              unpushedCommitShortHashes: [],
            })
          }

          if (scope === "commits") {
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
              unpushedCommitShortHashes: Array.isArray(
                commits?.unpushedCommitShortHashes
              )
                ? commits.unpushedCommitShortHashes
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
            unpushedCommitShortHashes: Array.isArray(
              gitChanges?.unpushedCommitShortHashes
            )
              ? gitChanges.unpushedCommitShortHashes
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
