import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/auth/api-key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            provider?: unknown
            key?: unknown
          }>(request)
          return jsonResponse(
            await getPhiRuntime().saveProviderApiKey(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to save provider API key")
        }
      },
    },
  },
})
