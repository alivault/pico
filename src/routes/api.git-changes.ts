import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/git-changes")({
  server: {
    handlers: createLegacyProxyHandlers("/api/git-changes", ["GET"]),
  },
})
