import { createFileRoute } from "@tanstack/react-router"

import { getPicoRuntime } from "@/server/pico-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/terminal/$id/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          return await getPicoRuntime().createTerminalEventsResponse(
            request,
            params.id
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to connect terminal")
        }
      },
    },
  },
})
