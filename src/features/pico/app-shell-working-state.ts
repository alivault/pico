export const COMPACT_WORKING_LABEL = "Compacting context..."
export const COMPACT_CANCELLED_LABEL = "Error: Compaction cancelled"

export type AppShellWorkingState = {
  label: string
  summary?: string
  done?: boolean
  error?: boolean
  cancelable?: boolean
}

export function sameWorkingState(
  left: AppShellWorkingState | null,
  right: AppShellWorkingState | null
) {
  return (
    left?.label === right?.label &&
    left?.summary === right?.summary &&
    left?.done === right?.done &&
    left?.error === right?.error &&
    left?.cancelable === right?.cancelable
  )
}
