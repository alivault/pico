import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/auth/providers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return jsonResponse(await getPhiRuntime().getAuthProviders(request))
        } catch (error) {
          return routeErrorResponse(error, "Failed to list auth providers")
        }
      },
    },
  },
})
