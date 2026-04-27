import { createFileRoute } from "@tanstack/react-router"

import type { GitCommitMessageResponse } from "@/lib/pi-web-api"
import { jsonResponse } from "@/server/http"
import { generateDirectoryGitCommitMessage } from "@/server/git"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-commit-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ cwd?: unknown }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")

          const { context, activeEntry } =
            await getPiWebRuntime().resolveRequest(request)
          const baseCwd = getPiWebRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await generateDirectoryGitCommitMessage(
            cwd,
            activeEntry.services.modelRegistry
          )
          return jsonResponse({
            ok: true,
            cwd,
            message: result.message,
            source: result.source,
            reason: result.reason,
          } satisfies GitCommitMessageResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to generate commit message")
        }
      },
    },
  },
})
