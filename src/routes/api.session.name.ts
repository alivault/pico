import { createFileRoute } from "@tanstack/react-router"

import type { GenerateSessionNameResponse } from "@/lib/pico/api"
import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/session/name")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ path?: unknown }>(request)
          return jsonResponse(
            (await getPicoRuntime().generateSessionName(
              request,
              body
            )) satisfies GenerateSessionNameResponse
          )
        } catch (error) {
          return routeErrorResponse(error, "Failed to generate session name")
        }
      },
    },
  },
})
