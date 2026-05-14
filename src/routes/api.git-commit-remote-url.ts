import { createFileRoute } from "@tanstack/react-router"

import type { GitCommitRemoteUrlResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { readDirectoryGitCommitRemoteUrl } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-commit-remote-url")({
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
          const result = await readDirectoryGitCommitRemoteUrl(cwd, commit)
          if (!result?.remoteUrl) throw new Error("No remote URL found")

          return jsonResponse({
            ok: true,
            cwd,
            commit: result.commit,
            remoteUrl: result.remoteUrl,
          } satisfies GitCommitRemoteUrlResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to read commit remote URL")
        }
      },
    },
  },
})
