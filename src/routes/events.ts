import { createFileRoute } from "@tanstack/react-router"

import { getPhiRuntime } from "@/server/phi-runtime"

export const Route = createFileRoute("/events")({
  server: {
    handlers: {
      GET: ({ request }) => getPhiRuntime().createEventsResponse(request),
    },
  },
})
