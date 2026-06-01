import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/terminal/$id/resize")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readRequestJson<{
            cols?: unknown
            rows?: unknown
          }>(request)
          return jsonResponse(
            await getPicoRuntime().resizeTerminal(request, params.id, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to resize terminal")
        }
      },
    },
  },
})
