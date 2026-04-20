import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/pending-message/remove")({
  server: {
    handlers: createNotImplementedHandlers("/api/pending-message/remove", [
      "POST",
    ]),
  },
})
