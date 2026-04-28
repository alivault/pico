import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/abort")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return jsonResponse(await getPhiRuntime().abort(request))
        } catch (error) {
          return routeErrorResponse(error, "Failed to abort session")
        }
      },
    },
  },
})
