import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/fork")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return jsonResponse(
            await getPiWebRuntime().getForkableMessages(request)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to list forkable messages")
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ entryId?: unknown }>(request)
          return jsonResponse(
            await getPiWebRuntime().forkSession(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to fork session")
        }
      },
    },
  },
})
