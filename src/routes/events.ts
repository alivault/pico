import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/events")({
  server: {
    handlers: createNotImplementedHandlers("/events", ["GET"]),
  },
})
