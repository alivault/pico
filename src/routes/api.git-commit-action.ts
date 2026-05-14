import { createFileRoute } from "@tanstack/react-router"

import type { GitActionResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import {
  runDirectoryGitCommitAction,
  type GitCommitActionKind,
} from "@/server/git"
import { getPicoRuntime } from "@/server/pico-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

const gitCommitActions = new Set<GitCommitActionKind>([
  "checkout",
  "cherry-pick",
  "revert",
  "tag",
  "reset",
  "rebase",
  "drop",
  "squash",
])

export const Route = createFileRoute("/api/git-commit-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cwd?: unknown
            action?: unknown
            commit?: unknown
            tagName?: unknown
            resetMode?: unknown
            message?: unknown
          }>(request)
          const requestedCwd = typeof body.cwd === "string" ? body.cwd : ""
          const action = typeof body.action === "string" ? body.action : ""
          const commit = typeof body.commit === "string" ? body.commit : ""
          if (!requestedCwd.trim()) throw new Error("cwd is required")
          if (!gitCommitActions.has(action as GitCommitActionKind)) {
            throw new Error("action is required")
          }
          if (!commit.trim()) throw new Error("commit is required")

          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const result = await runDirectoryGitCommitAction(
            cwd,
            action as GitCommitActionKind,
            commit,
            {
              tagName: typeof body.tagName === "string" ? body.tagName : "",
              resetMode:
                typeof body.resetMode === "string" ? body.resetMode : "",
              message: typeof body.message === "string" ? body.message : "",
            }
          )
          return jsonResponse({
            ok: true,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
          } satisfies GitActionResponse)
        } catch (error) {
          return routeErrorResponse(error, "Failed to run commit action")
        }
      },
    },
  },
})
