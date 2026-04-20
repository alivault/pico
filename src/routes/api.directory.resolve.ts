import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/directory/resolve")({
  server: {
    handlers: createLegacyProxyHandlers("/api/directory/resolve", ["POST"]),
  },
})
