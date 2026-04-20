import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { readDirectoryGitStatus } from "@/server/git"
import { resolveDirectoryPath } from "@/server/project-paths"

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
          const cwd = await resolveDirectoryPath(requestedCwd, process.cwd())
          const gitStatus = await readDirectoryGitStatus(cwd)
          return jsonResponse({ ok: true, cwd, gitStatus })
        } catch (error) {
          return errorResponse(
            error instanceof Error ? error.message : "Failed to read git status"
          )
        }
      },
    },
  },
})
