import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/abort")({
  server: {
    handlers: createLegacyProxyHandlers("/api/abort", ["POST"]),
  },
})
