import * as React from "react"

/**
 * The machine of a subtree. The route wraps the app shell of each machine in
 * a `MachineProvider`. Code below it gets its machine from `useMachineId()`
 * and names it in each request and storage key.
 */
const MachineIdContext = React.createContext<string | null>(null)

export function MachineProvider({
  machineId,
  children,
}: {
  machineId: string
  children: React.ReactNode
}) {
  return <MachineIdContext value={machineId}>{children}</MachineIdContext>
}

/** The machine of this subtree. Throws outside a `MachineProvider`. */
export function useMachineId() {
  const machineId = React.useContext(MachineIdContext)
  if (machineId === null) {
    throw new Error("useMachineId needs a MachineProvider")
  }
  return machineId
}

/**
 * Whether an element is in the app shell that shows. The page keeps the
 * shells of other machines in a hidden `Activity`, which sets
 * `display: none` on the shell's root (see `routes/index.tsx`). Use this to
 * skip their elements in `document.querySelectorAll` results.
 */
export function isInShownMachineShell(element: Element) {
  const shell = element.closest<HTMLElement>("[data-machine-shell]")
  return !shell || shell.style.display !== "none"
}
