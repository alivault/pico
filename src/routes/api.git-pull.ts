import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { pullDirectoryGitChanges } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-pull")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ cwd?: unknown }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await pullDirectoryGitChanges(cwd)
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to pull changes")
        }
      },
    },
  },
})
