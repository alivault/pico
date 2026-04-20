import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/slash-command")({
  server: {
    handlers: createNotImplementedHandlers("/api/slash-command", ["POST"]),
  },
})
