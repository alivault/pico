import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/ui/$id")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readRequestJson<Record<string, unknown>>(request)
          return jsonResponse(
            await getPiWebRuntime().resolveUiRequest(params.id, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to resolve UI request")
        }
      },
    },
  },
})
