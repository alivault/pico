import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/session/tree/label")({
  server: {
    handlers: createLegacyProxyHandlers("/api/session/tree/label", ["POST"]),
  },
})
