import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/session/tree/label")({
  server: {
    handlers: createNotImplementedHandlers("/api/session/tree/label", ["POST"]),
  },
})
