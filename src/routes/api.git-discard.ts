import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import {
  discardDirectoryGitAll,
  discardDirectoryGitFile,
  nukeDirectoryGitWorkingTree,
} from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/git-discard")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            action?: unknown
            all?: unknown
            cwd?: unknown
            path?: unknown
            previousPath?: unknown
            status?: unknown
          }>(request)
          const action = typeof body.action === "string" ? body.action : ""
          const all = body.all === true
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          const path = typeof body.path === "string" ? body.path : ""
          const previousPath =
            typeof body.previousPath === "string" ? body.previousPath : ""
          const status = typeof body.status === "string" ? body.status : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (
            !path.trim() &&
            !all &&
            action !== "discard-all" &&
            action !== "nuke-working-tree"
          ) {
            throw new Error("file path is required")
          }

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result =
            action === "nuke-working-tree"
              ? await nukeDirectoryGitWorkingTree(cwd)
              : all || action === "discard-all"
                ? await discardDirectoryGitAll(cwd)
                : await discardDirectoryGitFile(
                    cwd,
                    path,
                    previousPath || undefined,
                    status || undefined
                  )
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to discard changes")
        }
      },
    },
  },
})
