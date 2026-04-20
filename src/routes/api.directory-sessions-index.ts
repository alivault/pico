import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/directory-sessions-index")({
  server: {
    handlers: createLegacyProxyHandlers("/api/directory-sessions-index", [
      "GET",
    ]),
  },
})
