import type { ExtensionUiEvent } from "@/lib/pi-web-api"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type AppShellUiRequestDialogProps = {
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
}

export function AppShellUiRequestDialog({
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
}: AppShellUiRequestDialogProps) {
  return (
    <Dialog
      open={Boolean(pendingUiRequest)}
      onOpenChange={(open) => {
        if (!open && pendingUiRequest) {
          onResolveUiRequest({ cancelled: true })
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pendingUiRequest?.title || "Pi request"}</DialogTitle>
          {pendingUiRequest?.message && (
            <DialogDescription>{pendingUiRequest.message}</DialogDescription>
          )}
        </DialogHeader>
        {(pendingUiRequest?.method === "input" ||
          pendingUiRequest?.method === "editor") &&
          (pendingUiRequest.method === "editor" ? (
            <Textarea
              value={pendingUiValue}
              onChange={(event) => onPendingUiValueChange(event.target.value)}
              placeholder={pendingUiRequest.placeholder}
            />
          ) : (
            <Input
              value={pendingUiValue}
              onChange={(event) => onPendingUiValueChange(event.target.value)}
              placeholder={pendingUiRequest.placeholder}
            />
          ))}
        {pendingUiRequest?.method === "select" && (
          <div className="space-y-2">
            {pendingUiRequest.options?.map((option) => {
              const value = typeof option === "string" ? option : option.value
              const label =
                typeof option === "string"
                  ? option
                  : option.label || option.value
              return (
                <Button
                  key={value}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => onResolveUiRequest({ value })}
                >
                  {label}
                </Button>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onResolveUiRequest({ cancelled: true })}
          >
            Cancel
          </Button>
          {pendingUiRequest?.method === "confirm" && (
            <Button onClick={() => onResolveUiRequest({ confirmed: true })}>
              Confirm
            </Button>
          )}
          {(pendingUiRequest?.method === "input" ||
            pendingUiRequest?.method === "editor") && (
            <Button
              onClick={() => onResolveUiRequest({ value: pendingUiValue })}
            >
              Submit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
