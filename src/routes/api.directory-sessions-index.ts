import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory-sessions-index")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const directory = url.searchParams.get("directory") || ""

        if (!directory.trim()) {
          return errorResponse("directory is required")
        }

        try {
          return jsonResponse(
            await getPicoRuntime().listDirectorySessionIndex(request, directory)
          )
        } catch (error) {
          return routeErrorResponse(
            error,
            "Failed to list directory session index"
          )
        }
      },
    },
  },
})
