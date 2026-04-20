import { createFileRoute } from "@tanstack/react-router"

import { notImplementedResponse } from "@/server/not-implemented"

export const Route = createFileRoute("/api/ui/$id")({
  server: {
    handlers: {
      POST: () => notImplementedResponse("/api/ui/$id"),
    },
  },
})
