import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/prompt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            message?: unknown
            images?: unknown
            streamingBehavior?: unknown
            pendingId?: unknown
            thinkingLevel?: unknown
          }>(request)
          return jsonResponse(await getPiWebRuntime().prompt(request, body))
        } catch (error) {
          return routeErrorResponse(error, "Failed to submit prompt")
        }
      },
    },
  },
})
