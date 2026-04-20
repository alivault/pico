import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/prompt")({
  server: {
    handlers: createLegacyProxyHandlers("/api/prompt", ["POST"]),
  },
})
