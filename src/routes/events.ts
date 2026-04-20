import { createFileRoute } from "@tanstack/react-router"

import { getPiWebRuntime } from "@/server/pi-web-runtime"

export const Route = createFileRoute("/events")({
  server: {
    handlers: {
      GET: ({ request }) => getPiWebRuntime().createEventsResponse(request),
    },
  },
})
