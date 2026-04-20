import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { resolveDirectoryPath } from "@/server/project-paths"

export const Route = createFileRoute("/api/directory/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          path?: unknown
        }
        const pathInput = typeof body.path === "string" ? body.path : ""

        try {
          const resolvedPath = await resolveDirectoryPath(
            pathInput,
            process.cwd()
          )
          return jsonResponse({ ok: true, path: resolvedPath })
        } catch (error) {
          return errorResponse(
            error instanceof Error ? error.message : "Failed to resolve path"
          )
        }
      },
    },
  },
})
