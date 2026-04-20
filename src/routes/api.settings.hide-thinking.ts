import { createFileRoute } from "@tanstack/react-router"

import { createNotImplementedHandlers } from "@/server/not-implemented"

export const Route = createFileRoute("/api/settings/hide-thinking")({
  server: {
    handlers: createNotImplementedHandlers("/api/settings/hide-thinking", [
      "POST",
    ]),
  },
})
