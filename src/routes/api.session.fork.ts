import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/fork")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return jsonResponse(
            await getPhiRuntime().getForkableMessages(request)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to list forkable messages")
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ entryId?: unknown }>(request)
          return jsonResponse(await getPhiRuntime().forkSession(request, body))
        } catch (error) {
          return routeErrorResponse(error, "Failed to fork session")
        }
      },
    },
  },
})
