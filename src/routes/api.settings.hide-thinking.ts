import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/settings/hide-thinking")({
  server: {
    handlers: createLegacyProxyHandlers("/api/settings/hide-thinking", [
      "POST",
    ]),
  },
})
