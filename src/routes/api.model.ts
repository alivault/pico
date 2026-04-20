import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/model")({
  server: {
    handlers: createLegacyProxyHandlers("/api/model", ["POST"]),
  },
})
