import { createFileRoute } from "@tanstack/react-router"

import type { DeleteOldDirectorySessionsRequest } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory-sessions/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body =
            await readRequestJson<DeleteOldDirectorySessionsRequest>(request)
          return jsonResponse(
            await getPicoRuntime().deleteOldDirectorySessions(request, body)
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to clean up sessions")
        }
      },
    },
  },
})
