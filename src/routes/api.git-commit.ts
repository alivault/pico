import { createFileRoute } from "@tanstack/react-router"

import type { GitCommitResponse } from "@/lib/phi/api"
import { jsonResponse } from "@/server/http"
import { commitDirectoryGitChanges } from "@/server/git"
import { getPhiRuntime } from "@/server/phi-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-commit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cwd?: unknown
            message?: unknown
            push?: unknown
            includeUnstaged?: unknown
          }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          const message = typeof body.message === "string" ? body.message : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!message.trim()) throw new Error("commit message is required")

          const { context, activeEntry } =
            await getPhiRuntime().resolveRequest(request)
          const baseCwd = getPhiRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await commitDirectoryGitChanges(cwd, message, {
            push: body.push === true,
            includeUnstaged: body.includeUnstaged !== false,
          })
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitCommitResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to commit changes")
        }
      },
    },
  },
})
