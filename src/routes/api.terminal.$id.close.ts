import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/terminal/$id/close")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          return jsonResponse(
            await getPicoRuntime().closeTerminal(request, params.id)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to close terminal")
        }
      },
    },
  },
})
