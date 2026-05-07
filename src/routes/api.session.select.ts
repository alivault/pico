import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/select")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return jsonResponse(await getPicoRuntime().selectSession(request))
        } catch (error) {
          return routeErrorResponse(error, "Failed to select session")
        }
      },
    },
  },
})
