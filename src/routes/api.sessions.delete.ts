import { createFileRoute } from "@tanstack/react-router"

import type { DeleteSessionsRequest } from "@/lib/pi-web-api"
import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/sessions/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<DeleteSessionsRequest>(request)
          return jsonResponse(
            await getPiWebRuntime().deleteSessions(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to delete sessions")
        }
      },
    },
  },
})
