import { createFileRoute } from "@tanstack/react-router"

import { getPicoRuntime } from "@/server/pico-runtime"

export const Route = createFileRoute("/events")({
  server: {
    handlers: {
      GET: ({ request }) => getPicoRuntime().createEventsResponse(request),
    },
  },
})
