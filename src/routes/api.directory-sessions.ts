import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/directory-sessions")({
  server: {
    handlers: createNotImplementedHandlers("/api/directory-sessions", ["GET"]),
  },
})
