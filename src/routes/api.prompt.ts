import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/prompt")({
  server: {
    handlers: createNotImplementedHandlers("/api/prompt", ["POST"]),
  },
})
