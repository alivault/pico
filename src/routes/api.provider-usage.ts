import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { fetchProviderUsage } from "@/server/provider-usage"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/provider-usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const provider = url.searchParams.get("provider") || undefined

        try {
          return jsonResponse({
            ok: true,
            usage: await fetchProviderUsage(provider),
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to read provider usage")
        }
      },
    },
  },
})
