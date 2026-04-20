import { createFileRoute } from "@tanstack/react-router"

import { proxyLegacyPiWebRequest } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/ui/$id")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        proxyLegacyPiWebRequest(
          request,
          `/api/ui/${encodeURIComponent(params.id)}`
        ),
    },
  },
})
