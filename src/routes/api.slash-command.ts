import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/slash-command")({
  server: {
    handlers: createLegacyProxyHandlers("/api/slash-command", ["POST"]),
  },
})
