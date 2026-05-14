import { createFileRoute } from "@tanstack/react-router"

import type { GitCommitDiffResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import {
  readDirectoryGitCommitDiff,
  type GitCommitDiffMode,
} from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

function normalizeGitCommitDiffMode(value: string | null): GitCommitDiffMode {
  if (value === "head" || value === "previous") return value
  return "commit"
}

export const Route = createFileRoute("/api/git-commit-diff")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const requestedCwd = url.searchParams.get("cwd") || ""
          const commit = url.searchParams.get("commit") || ""
          const mode = normalizeGitCommitDiffMode(url.searchParams.get("mode"))
          const path = url.searchParams.get("path") || undefined
          const previousPath = url.searchParams.get("previousPath") || undefined
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!commit.trim()) throw new Error("commit is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await readDirectoryGitCommitDiff(
            cwd,
            commit,
            mode,
            path,
            previousPath
          )
          return jsonResponse({
            ok: true,
            cwd,
            commit: result?.commit || commit,
            mode,
            title: result?.title || commit,
            ...(result?.path ? { path: result.path } : {}),
            ...(result?.previousPath
              ? { previousPath: result.previousPath }
              : {}),
            patch: result?.patch || "No git repository detected.",
          } satisfies GitCommitDiffResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to read commit diff")
        }
      },
    },
  },
})
