import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/model")({
  server: {
    handlers: createNotImplementedHandlers("/api/model", ["POST"]),
  },
})
