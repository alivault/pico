import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/tree/label")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            entryId?: unknown
            label?: unknown
          }>(request)
          return jsonResponse(
            await getPiWebRuntime().setSessionTreeLabel(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to update tree label")
        }
      },
    },
  },
})
