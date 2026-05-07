import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory-sessions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const directory = url.searchParams.get("directory") || ""
        const offset = Number.parseInt(
          url.searchParams.get("offset") || "0",
          10
        )
        const limit = Number.parseInt(url.searchParams.get("limit") || "5", 10)

        if (!directory.trim()) {
          return errorResponse("directory is required")
        }

        try {
          return jsonResponse(
            await getPicoRuntime().listDirectorySessions(request, directory, {
              offset: Number.isNaN(offset) ? 0 : offset,
              limit: Number.isNaN(limit) ? 5 : limit,
            })
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to list directory sessions")
        }
      },
    },
  },
})
