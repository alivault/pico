import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/file-completions")({
  server: {
    handlers: createLegacyProxyHandlers("/api/file-completions", ["POST"]),
  },
})
