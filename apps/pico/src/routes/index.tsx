import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { createPortal } from "react-dom"
import { z } from "zod"

import { PortalContainerProvider } from "@/components/ui/portal-container"
import { SidebarProvider } from "@/components/ui/sidebar"
import { PicoAppShell } from "@/features/pico/app-shell"
import { MachinesDialogController } from "@/features/pico/machines"
import { WindowSidebar } from "@/features/pico/window-sidebar"
import type { SelectSessionNavigationOptions } from "@/features/pico/app-shell-types"
import {
  LOCAL_MACHINE_ID,
  normalizeMachineId,
  setMachineNavigator,
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

/** The session that the app shell of each opened machine shows. */
type MachineWorkspaces = Record<string, { sessionId?: string }>

function machineSearch(machineId: string, sessionId: string | undefined) {
  return {
    ...(machineId === LOCAL_MACHINE_ID ? {} : { machine: machineId }),
    ...(sessionId ? { session: sessionId } : {}),
  }
}

/**
 * The page keeps an app shell for each machine that it opened, like a
 * terminal multiplexer keeps a pane for each machine. The URL selects the
 * machine and the session that show. The shells of the other machines stay
 * mounted in a hidden `Activity`: they keep their state (the composer text,
 * the right sidebar, open files), and their effects (the event stream,
 * window listeners) stop until they show again.
 *
 * The window owns its window UI one time for all shells: the left sidebar
 * (`WindowSidebar`; the shown shell fills its slots), its open state, and
 * the machines dialog. Each shell owns only its machine's state.
 */
function App() {
  const { session, machine: machineParam } = Route.useSearch()
  const navigate = Route.useNavigate()
  const shownMachine = normalizeMachineId(machineParam)

  const [workspaces, setWorkspaces] = React.useState<MachineWorkspaces>(() => ({
    [shownMachine]: { sessionId: session },
  }))
  // The URL is the source of the shown machine and session: a click in the
  // sidebar and the back and forward buttons both change it.
  if (
    !(shownMachine in workspaces) ||
    workspaces[shownMachine]?.sessionId !== session
  ) {
    setWorkspaces((current) => ({
      ...current,
      [shownMachine]: { sessionId: session },
    }))
  }

  React.useEffect(() => {
    setMachineNavigator((nextMachine, nextSession) => {
      void navigate({ search: machineSearch(nextMachine, nextSession) })
    })
    return () => setMachineNavigator(undefined)
  }, [navigate])

  const selectSession = (
    machineId: string,
    nextSessionId: string | undefined,
    options: SelectSessionNavigationOptions | undefined
  ) => {
    const nextRouteSessionId = nextSessionId || undefined
    // A hidden shell changes its own session (for example when a request
    // that started before the switch ends). It does not take the page back.
    if (machineId !== shownMachine) {
      setWorkspaces((current) =>
        current[machineId]?.sessionId === nextRouteSessionId
          ? current
          : { ...current, [machineId]: { sessionId: nextRouteSessionId } }
      )
      return
    }
    if (nextRouteSessionId === session) return

    void navigate({
      search: (previous) => ({
        ...previous,
        session: nextRouteSessionId,
      }),
      replace: options?.replace ?? false,
    })
  }

  return (
    <SidebarProvider className="h-full flex-col overflow-hidden bg-background [--header-height:calc(3rem+env(safe-area-inset-top))]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WindowSidebar shownMachineId={shownMachine} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {Object.entries(workspaces).map(([machineId, workspace]) => (
            <React.Activity
              key={machineId}
              mode={machineId === shownMachine ? "visible" : "hidden"}
            >
              <MachineShell machineId={machineId}>
                <PicoAppShell
                  sessionId={
                    machineId === shownMachine ? session : workspace.sessionId
                  }
                  onSelectSession={(nextSessionId, options) =>
                    selectSession(machineId, nextSessionId, options)
                  }
                />
              </MachineShell>
            </React.Activity>
          ))}
        </div>
      </div>
      <MachinesDialogController />
    </SidebarProvider>
  )
}

/**
 * The frame of one machine's app shell: its machine, its query cache, and a
 * container for its floating UI. The container is a portal at the top of the
 * `Activity`, so the hidden `Activity` hides it too: a menu that was open
 * when the shell hid does not stay on the screen.
 */
function MachineShell({
  machineId,
  children,
}: {
  machineId: string
  children: React.ReactNode
}) {
  const [portalContainer, setPortalContainer] =
    React.useState<HTMLElement | null>(null)
  return (
    <>
      {createPortal(
        <div ref={setPortalContainer} data-machine-portals={machineId} />,
        document.body
      )}
      {/* `isInShownMachineShell` finds the shell by this attribute. */}
      <div data-machine-shell={machineId} className="contents">
        <MachineProvider machineId={machineId}>
          <QueryClientProvider client={queryClientForMachine(machineId)}>
            <PortalContainerProvider value={portalContainer}>
              {children}
            </PortalContainerProvider>
          </QueryClientProvider>
        </MachineProvider>
      </div>
    </>
  )
}
