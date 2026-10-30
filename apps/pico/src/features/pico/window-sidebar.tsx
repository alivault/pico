import {
  Sidebar,
  SidebarContent,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { SidebarMachineGroups } from "@/features/pico/machines"
import type { MachineInfo } from "@/features/pico/machine-store"
import { ProjectActions, OtherMachineProjects } from "@/features/pico/sidebar"
import { sidebarSlotRef } from "@/features/pico/sidebar-slots"
import { openMachine, queueMachineAction } from "@/lib/pico/machine"
import { MachineProvider } from "@/lib/pico/machine-context"

/**
 * The left sidebar of the window. The page draws it one time, above the app
 * shells of its machines, so the machine headings, their buttons, and the
 * scroll position stay when you switch machines. Like the machine list of
 * Herdr, each machine has the same heading and the same buttons.
 *
 * The shell of the shown machine fills the slots of its machine (see
 * `sidebar-slots.ts`): the search button, its live projects, and its
 * footer. The other machines show their projects from their hub
 * summaries.
 */
export function WindowSidebar({ shownMachineId }: { shownMachineId: string }) {
  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border/70 pt-[env(safe-area-inset-top)]"
    >
      <SidebarContent>
        {/* Search covers all machines, so it stays above their groups. */}
        <div
          key={`top:${shownMachineId}`}
          ref={sidebarSlotRef("top", shownMachineId)}
          className="contents"
        />
        <SidebarMachineGroups
          shownMachineId={shownMachineId}
          shownContent={
            <div
              key={`content:${shownMachineId}`}
              ref={sidebarSlotRef("content", shownMachineId)}
              className="contents"
            />
          }
          renderContent={(machine) => (
            <MachineProvider machineId={machine.id}>
              <OtherMachineProjects machine={machine} />
            </MachineProvider>
          )}
          renderActions={(machine, shown) => (
            <MachineProjectActions machine={machine} shown={shown} />
          )}
        />
        <div
          key={`bottom:${shownMachineId}`}
          ref={sidebarSlotRef("bottom", shownMachineId)}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * Add project on any machine. On the shown machine it opens the dialog at
 * once. On another machine it opens that machine with the dialog, because
 * the dialog completes paths and checks them on that machine.
 */
function MachineProjectActions({
  machine,
  shown,
}: {
  machine: MachineInfo
  shown: boolean
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  if (!shown && machine.state !== "online") return null
  return (
    <ProjectActions
      title={shown ? "Add project" : `Add project on ${machine.label}`}
      showShortcut={shown}
      onOpenAddProjectDialog={() => {
        if (isMobile) setOpenMobile(false)
        if (shown) queueMachineAction(machine.id, { type: "add-project" })
        else openMachine(machine.id, { action: { type: "add-project" } })
      }}
    />
  )
}
