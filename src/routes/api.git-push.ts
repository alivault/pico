import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { pushDirectoryGitChanges } from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cwd?: unknown
            force?: unknown
            forcePush?: unknown
          }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await pushDirectoryGitChanges(cwd, {
            force: body.force === true || body.forcePush === true,
          })
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
            ...(result.pushedCommitMessages
              ? { pushedCommitMessages: result.pushedCommitMessages }
              : {}),
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to push changes")
        }
      },
    },
  },
})
