import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/abort")({
  server: {
    handlers: createNotImplementedHandlers("/api/abort", ["POST"]),
  },
})
