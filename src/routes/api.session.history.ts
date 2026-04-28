import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const before = Number(url.searchParams.get("before"))
          const limit = Number(url.searchParams.get("limit"))

          return jsonResponse(
            await getPhiRuntime().getSessionHistory(request, {
              before: Number.isFinite(before) ? before : undefined,
              limit: Number.isFinite(limit) ? limit : undefined,
            })
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to load session history")
        }
      },
    },
  },
})
