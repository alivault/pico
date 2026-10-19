import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { PicoAppShell } from "@/features/pico/app-shell"
import type { SelectSessionNavigationOptions } from "@/features/pico/app-shell-types"
import {
  LOCAL_MACHINE_ID,
  normalizeMachineId,
  pageMachine,
  setMachineNavigator,
  setPageMachine,
} from "@/lib/pico/machine"
import { MachineProvider } from "@/lib/pico/machine-context"
import { queryClientForMachine } from "@/lib/pico/query-client"

const indexSearchSchema = z.object({
  session: z.string().optional(),
  /** A remote machine of the hub; see `lib/pico/machine.ts`. */
  machine: z.string().optional(),
})

export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  component: App,
})

function App() {
  const { session, machine: machineParam } = Route.useSearch()
  const navigate = Route.useNavigate()
  const machine = normalizeMachineId(machineParam)

  // The URL is the source of the machine: a click in the sidebar and the
  // back and forward buttons both change it. Switch before the shell of the
  // new machine renders, so that its first requests go to that machine. This
  // runs once for each switch: then the machine of the page is equal.
  if (machine !== pageMachine()) setPageMachine(machine)

  React.useEffect(() => {
    setMachineNavigator((nextMachine, nextSession) => {
      void navigate({
        search: {
          ...(nextMachine === LOCAL_MACHINE_ID ? {} : { machine: nextMachine }),
          ...(nextSession ? { session: nextSession } : {}),
        },
      })
    })
    return () => setMachineNavigator(undefined)
  }, [navigate])

  return (
    <MachineProvider machineId={machine}>
      <QueryClientProvider client={queryClientForMachine(machine)}>
        <PicoAppShell
          key={machine}
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
      </QueryClientProvider>
    </MachineProvider>
  )
}
