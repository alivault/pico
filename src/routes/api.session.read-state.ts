import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/read-state")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            path?: unknown
            unread?: unknown
          }>(request)
          return jsonResponse(
            await getPicoRuntime().setSessionReadState(request, body)
          )
        } catch (error) {
          return routeErrorResponse(
            error,
            "Failed to update session read state"
          )
        }
      },
    },
  },
})
