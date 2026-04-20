import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/pending-message/remove")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ pendingId?: unknown }>(request)
          return jsonResponse(
            await getPiWebRuntime().removePendingMessage(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to remove pending prompt")
        }
      },
    },
  },
})
