import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/events")({
  server: {
    handlers: createLegacyProxyHandlers("/events", ["GET"]),
  },
})
