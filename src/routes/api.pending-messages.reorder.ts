import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/pending-messages/reorder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            pendingMessages?: unknown
            pendingIds?: unknown
          }>(request)
          return jsonResponse(
            await getPhiRuntime().reorderPendingMessages(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to update pending prompts")
        }
      },
    },
  },
})
