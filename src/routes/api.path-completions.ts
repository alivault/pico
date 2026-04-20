import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/path-completions")({
  server: {
    handlers: createLegacyProxyHandlers("/api/path-completions", ["POST"]),
  },
})
