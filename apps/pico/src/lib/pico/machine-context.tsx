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
