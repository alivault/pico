import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/git-status")({
  server: {
    handlers: createLegacyProxyHandlers("/api/git-status", ["GET"]),
  },
})
