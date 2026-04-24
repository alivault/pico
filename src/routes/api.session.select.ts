import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/select")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return jsonResponse(await getPiWebRuntime().selectSession(request))
        } catch (error) {
          return routeErrorResponse(error, "Failed to select session")
        }
      },
    },
  },
})
