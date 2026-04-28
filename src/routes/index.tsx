import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { PhiAppShell } from "@/features/phi/app-shell"
import type { SelectSessionNavigationOptions } from "@/features/phi/app-shell"

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
    <PhiAppShell
      sessionId={session}
      onSelectSession={(
        nextSessionId?: string,
        options?: SelectSessionNavigationOptions
      ) => {
        const nextRouteSessionId = nextSessionId || undefined
        if (nextRouteSessionId === session) return

        void navigate({
          search: (previous) => ({
            ...previous,
            session: nextRouteSessionId,
          }),
          replace: options?.replace ?? false,
        })
      }}
    />
  )
}
