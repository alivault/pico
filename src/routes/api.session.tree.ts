import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/session/tree")({
  server: {
    handlers: createNotImplementedHandlers("/api/session/tree", [
      "GET",
      "POST",
    ]),
  },
})
