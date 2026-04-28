import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/slash-command")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            name?: unknown
            args?: unknown
          }>(request)
          return jsonResponse(
            await getPhiRuntime().runSlashCommand(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to run slash command")
        }
      },
    },
  },
})
