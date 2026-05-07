import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
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
            await getPicoRuntime().runSlashCommand(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to run slash command")
        }
      },
    },
  },
})
