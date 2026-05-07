import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { readDirectoryGitStatus } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        if (!requestedCwd.trim()) {
          return errorResponse("cwd is required")
        }

        try {
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          return jsonResponse({
            ok: true,
            cwd,
            gitStatus: await readDirectoryGitStatus(cwd),
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to read git status")
        }
      },
    },
  },
})
