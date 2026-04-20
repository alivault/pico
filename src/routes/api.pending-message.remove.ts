import { createFileRoute } from "@tanstack/react-router"

import { createLegacyProxyHandlers } from "@/server/legacy-pi-web"

export const Route = createFileRoute("/api/pending-message/remove")({
  server: {
    handlers: createLegacyProxyHandlers("/api/pending-message/remove", [
      "POST",
    ]),
  },
})
