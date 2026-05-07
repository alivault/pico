import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/thinking")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ level?: unknown }>(request)
          return jsonResponse(await getPicoRuntime().setThinking(request, body))
        } catch (error) {
          return routeErrorResponse(error, "Failed to update thinking level")
        }
      },
    },
  },
})
