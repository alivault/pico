import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/thinking")({
  server: {
    handlers: createNotImplementedHandlers("/api/thinking", ["POST"]),
  },
})
