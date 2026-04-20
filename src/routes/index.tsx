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
  const navigate = Route.useNavigate()

  return (
    <PiWebAppShell
      sessionId={session}
      onSelectSession={(nextSessionId) => {
        void navigate({
          search: (previous) => ({
            ...previous,
            session: nextSessionId || undefined,
          }),
          replace: true,
        })
      }}
    />
  )
}
