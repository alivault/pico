import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/session/new")({
  server: {
    handlers: createNotImplementedHandlers("/api/session/new", ["POST"]),
  },
})
