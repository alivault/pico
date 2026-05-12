import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { stageDirectoryGitFile } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-stage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cwd?: unknown
            path?: unknown
            previousPath?: unknown
          }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          const path = typeof body.path === "string" ? body.path : ""
          const previousPath =
            typeof body.previousPath === "string" ? body.previousPath : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!path.trim()) throw new Error("file path is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await stageDirectoryGitFile(
            cwd,
            path,
            previousPath || undefined
          )
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to stage changes")
        }
      },
    },
  },
})
