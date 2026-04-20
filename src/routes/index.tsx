import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { PiWebAppShell } from "@/features/pi-web/app-shell"

const indexSearchSchema = z.object({
  session: z.string().optional(),
})

export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  component: App,
})

function App() {
  const { session } = Route.useSearch()

  return <PiWebAppShell sessionId={session} />
}
