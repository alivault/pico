import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory-sessions-indexes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const directories = url.searchParams.getAll("directory")

        if (directories.length === 0) {
          return errorResponse("at least one directory is required")
        }

        try {
          return jsonResponse(
            await getPiWebRuntime().listDirectorySessionIndexes(
              request,
              directories
            )
          )
        } catch (error) {
          return routeErrorResponse(
            error,
            "Failed to list directory session indexes"
          )
        }
      },
    },
  },
})
