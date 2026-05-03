import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            provider?: unknown
          }>(request)
          return jsonResponse(
            await getPhiRuntime().logoutProvider(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to logout from provider")
        }
      },
    },
  },
})
