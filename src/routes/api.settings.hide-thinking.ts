import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPhiRuntime } from "@/server/phi-runtime"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/settings/hide-thinking")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ hide?: unknown }>(request)
          return jsonResponse(await getPhiRuntime().setHideThinking(body))
        } catch (error) {
          return routeErrorResponse(
            error,
            "Failed to update hide-thinking setting"
          )
        }
      },
    },
  },
})
