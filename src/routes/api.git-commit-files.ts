import { createFileRoute } from "@tanstack/react-router"

import type { GitCommitFilesResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { readDirectoryGitCommitFiles } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-commit-files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const requestedCwd = url.searchParams.get("cwd") || ""
          const commit = url.searchParams.get("commit") || ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!commit.trim()) throw new Error("commit is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const files = await readDirectoryGitCommitFiles(cwd, commit)

          return jsonResponse({
            ok: true,
            cwd,
            commit,
            files: files || [],
          } satisfies GitCommitFilesResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to read commit files")
        }
      },
    },
  },
})
