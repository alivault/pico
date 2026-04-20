import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/highlight")({
  server: {
    handlers: createNotImplementedHandlers("/api/highlight", ["POST"]),
  },
})
