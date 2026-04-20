import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/session/new")({
  server: {
    handlers: createLegacyProxyHandlers("/api/session/new", ["POST"]),
  },
})
