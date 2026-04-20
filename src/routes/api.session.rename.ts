import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/session/rename")({
  server: {
    handlers: createNotImplementedHandlers("/api/session/rename", ["POST"]),
  },
})
