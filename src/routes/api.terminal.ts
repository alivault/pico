import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/terminal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            cols?: unknown
            rows?: unknown
          }>(request)
          return jsonResponse(
            await getPicoRuntime().createTerminal(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to create terminal")
        }
      },
    },
  },
})
