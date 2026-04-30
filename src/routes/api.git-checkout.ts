import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/phi/api"
import { jsonResponse } from "@/server/http"
import { checkoutDirectoryGitBranch } from "@/server/git"
import { getPhiRuntime } from "@/server/phi-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cwd?: unknown
            branch?: unknown
          }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          const branch = typeof body.branch === "string" ? body.branch : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!branch.trim()) throw new Error("branch is required")

          const { context, activeEntry } =
            await getPhiRuntime().resolveRequest(request)
          const baseCwd = getPhiRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await checkoutDirectoryGitBranch(cwd, branch)
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to switch branch")
        }
      },
    },
  },
})
