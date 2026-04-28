import type { ExtensionUiEvent } from "@/lib/phi/api"

import { AppShellUiRequestDialog } from "@/features/phi/app-shell-ui-request-dialog"

type AppShellDialogsProps = {
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
}

export function AppShellDialogs({
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
}: AppShellDialogsProps) {
  return (
    <>
      <AppShellUiRequestDialog
        pendingUiRequest={pendingUiRequest}
        pendingUiValue={pendingUiValue}
        onPendingUiValueChange={onPendingUiValueChange}
        onResolveUiRequest={onResolveUiRequest}
      />
    </>
  )
}
