import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/highlight")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            code?: unknown
            language?: unknown
          }>(request)
          return jsonResponse(
            await getPicoRuntime().highlightCode(body.code, body.language)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to highlight code")
        }
      },
    },
  },
})
