import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/tree")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return jsonResponse(
            await getPhiRuntime().getSessionTreeForRequest(request)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to read session tree")
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            targetId?: unknown
            summarize?: unknown
            customInstructions?: unknown
            replaceInstructions?: unknown
            label?: unknown
          }>(request)
          return jsonResponse(
            await getPhiRuntime().navigateSessionTree(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to navigate session tree")
        }
      },
    },
  },
})
