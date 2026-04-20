import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/new")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ cwd?: unknown }>(request)
          return jsonResponse(
            await getPiWebRuntime().createNewSession(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to create session")
        }
      },
    },
  },
})
