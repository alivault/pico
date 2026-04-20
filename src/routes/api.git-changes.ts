import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { readDirectoryGitChanges } from "@/server/git"
import { resolveDirectoryPath } from "@/server/project-paths"

export const Route = createFileRoute("/api/git-changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        if (!requestedCwd.trim()) {
          return errorResponse("cwd is required")
        }

        try {
          const cwd = await resolveDirectoryPath(requestedCwd, process.cwd())
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
            unpushedCommitShortHashes: Array.isArray(
              gitChanges?.unpushedCommitShortHashes
            )
              ? gitChanges.unpushedCommitShortHashes
              : gitChanges === null
                ? null
                : [],
          })
        } catch (error) {
          return errorResponse(
            error instanceof Error
              ? error.message
              : "Failed to read git changes"
          )
        }
      },
    },
  },
})
