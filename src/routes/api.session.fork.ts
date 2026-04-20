import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/session/fork")({
  server: {
    handlers: createNotImplementedHandlers("/api/session/fork", [
      "GET",
      "POST",
    ]),
  },
})
