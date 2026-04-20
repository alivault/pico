import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/pending-messages/reorder")({
  server: {
    handlers: createLegacyProxyHandlers("/api/pending-messages/reorder", [
      "POST",
    ]),
  },
})
