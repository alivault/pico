import { createFileRoute } from "@tanstack/react-router"

import type { DeleteSessionsRequest } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/sessions/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<DeleteSessionsRequest>(request)
          return jsonResponse(
            await getPicoRuntime().deleteSessions(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to delete sessions")
        }
      },
    },
  },
})
