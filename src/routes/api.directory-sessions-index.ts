import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/directory-sessions-index")({
  server: {
    handlers: createNotImplementedHandlers("/api/directory-sessions-index", [
      "GET",
    ]),
  },
})
