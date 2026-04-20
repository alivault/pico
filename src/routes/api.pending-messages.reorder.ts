import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/pending-messages/reorder")({
  server: {
    handlers: createNotImplementedHandlers("/api/pending-messages/reorder", [
      "POST",
    ]),
  },
})
