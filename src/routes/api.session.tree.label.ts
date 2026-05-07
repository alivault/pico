import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
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
            await getPicoRuntime().setSessionTreeLabel(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to update tree label")
        }
      },
    },
  },
})
