import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { createPortal } from "react-dom"
import { z } from "zod"

import { PortalContainerProvider } from "@/components/ui/portal-container"
import { SidebarProvider } from "@/components/ui/sidebar"
import { PicoAppShell } from "@/features/pico/app-shell"
import { MachinesDialogController } from "@/features/pico/machines"
import { ServerUnreachableOverlay } from "@/features/pico/server-unreachable-overlay"
import { WindowSidebar } from "@/features/pico/window-sidebar"
import type { SelectAgentNavigationOptions } from "@/features/pico/app-shell-types"
import {
  LOCAL_MACHINE_ID,
  normalizeMachineId,
  setMachineNavigator,
} from "@/lib/pico/machine"
import { MachineProvider } from "@/lib/pico/machine-context"
import { queryClientForMachine } from "@/lib/pico/query-client"
import { useServerConnection } from "@/lib/pico/server-connection"

const indexSearchSchema = z.object({
  agent: z.string().optional(),
  /** A remote machine of the hub; see `lib/pico/machine.ts`. */
  machine: z.string().optional(),
})

export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  component: App,
})

/** The agent that the app shell of each opened machine shows. */
type MachineWorkspaces = Record<string, { agentId?: string }>

function machineSearch(machineId: string, agentId: string | undefined) {
  return {
    ...(machineId === LOCAL_MACHINE_ID ? {} : { machine: machineId }),
    ...(agentId ? { agent: agentId } : {}),
  }
}

/**
 * The page keeps an app shell for each machine that it opened, like a
 * terminal multiplexer keeps a pane for each machine. The URL selects the
 * machine and the agent that show. The shells of the other machines stay
 * mounted in a hidden `Activity`: they keep their state (the composer text,
 * the right sidebar, open files), and their effects (the event stream,
 * window listeners) stop until they show again.
 *
 * The window owns its window UI one time for all shells: the left sidebar
 * (`WindowSidebar`; the shown shell fills its slots), its open state, and
 * the machines dialog. Each shell owns only its machine's state.
 */
function App() {
  const { agent, machine: machineParam } = Route.useSearch()
  const navigate = Route.useNavigate()
  const shownMachine = normalizeMachineId(machineParam)
  const serverUnreachable = useServerConnection() === "unreachable"

  const [workspaces, setWorkspaces] = React.useState<MachineWorkspaces>(() => ({
    [shownMachine]: { agentId: agent },
  }))
  // The URL is the source of the shown machine and agent: a click in the
  // sidebar and the back and forward buttons both change it.
  if (
    !(shownMachine in workspaces) ||
    workspaces[shownMachine]?.agentId !== agent
  ) {
    setWorkspaces((current) => ({
      ...current,
      [shownMachine]: { agentId: agent },
    }))
  }

  React.useEffect(() => {
    setMachineNavigator((nextMachine, nextAgent) => {
      void navigate({ search: machineSearch(nextMachine, nextAgent) })
    })
    return () => setMachineNavigator(undefined)
  }, [navigate])

  // A click on a push notification asks the service worker to open its
  // agent in this tab without a page load (see `public/sw.js`).
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null
      if (data?.type !== "pico:open-url" || typeof data.url !== "string") return
      let params: URLSearchParams
      try {
        params = new URL(data.url, window.location.origin).searchParams
      } catch {
        return
      }
      void navigate({
        search: machineSearch(
          normalizeMachineId(params.get("machine") ?? undefined),
          params.get("agent") ?? undefined
        ),
      })
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [navigate])

  const selectAgent = (
    machineId: string,
    nextAgentId: string | undefined,
    options: SelectAgentNavigationOptions | undefined
  ) => {
    const nextRouteAgentId = nextAgentId || undefined
    // A hidden shell changes its own agent (for example when a request
    // that started before the switch ends). It does not take the page back.
    if (machineId !== shownMachine) {
      setWorkspaces((current) =>
        current[machineId]?.agentId === nextRouteAgentId
          ? current
          : { ...current, [machineId]: { agentId: nextRouteAgentId } }
      )
      return
    }
    if (nextRouteAgentId === agent) return

    void navigate({
      search: (previous) => ({
        ...previous,
        agent: nextRouteAgentId,
      }),
      replace: options?.replace ?? false,
    })
  }

  return (
    <SidebarProvider className="h-full flex-col overflow-hidden bg-background [--header-height:calc(3rem+env(safe-area-inset-top))]">
      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        inert={serverUnreachable}
      >
        <WindowSidebar shownMachineId={shownMachine} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {Object.entries(workspaces).map(([machineId, workspace]) => (
            <React.Activity
              key={machineId}
              mode={machineId === shownMachine ? "visible" : "hidden"}
            >
              <MachineShell machineId={machineId}>
                <PicoAppShell
                  agentId={
                    machineId === shownMachine ? agent : workspace.agentId
                  }
                  onSelectAgent={(nextAgentId, options) =>
                    selectAgent(machineId, nextAgentId, options)
                  }
                />
              </MachineShell>
            </React.Activity>
          ))}
        </div>
      </div>
      <MachinesDialogController />
      {serverUnreachable ? <ServerUnreachableOverlay /> : null}
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
