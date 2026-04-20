import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/session/rename")({
  server: {
    handlers: createLegacyProxyHandlers("/api/session/rename", ["POST"]),
  },
})
