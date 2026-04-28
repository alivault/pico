import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ExtensionUiEvent, UiRequestResponse } from "@/lib/phi/api"

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
import { buildRequestUrl, fetchJson } from "@/features/phi/app-shell-utils"

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
          <DialogTitle>{pendingUiRequest?.title || "Phi request"}</DialogTitle>
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
export type AppShellUiRequestDialogHandle = {
  open: (request: ExtensionUiEvent) => void
  close: () => void
  isOpen: () => boolean
}

type AppShellUiRequestDialogControllerProps = {
  ref?: React.Ref<AppShellUiRequestDialogHandle>
  openStateRef?: React.MutableRefObject<boolean>
  viewerContextId: string
  sessionId?: string
}

export function AppShellUiRequestDialogController({
  ref,
  openStateRef,
  viewerContextId,
  sessionId,
}: AppShellUiRequestDialogControllerProps) {
  const [pendingUiRequest, setPendingUiRequest] =
    React.useState<ExtensionUiEvent | null>(null)
  const [pendingUiValue, setPendingUiValue] = React.useState("")
  const openRef = React.useRef(false)

  const setOpenState = (open: boolean) => {
    openRef.current = open
    if (openStateRef) {
      openStateRef.current = open
    }
  }

  const resolveUiRequestMutation = useMutation({
    mutationFn: async ({
      requestId,
      body,
    }: {
      requestId: string
      body: Record<string, unknown>
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<UiRequestResponse>(
        buildRequestUrl(`/api/ui/${encodeURIComponent(requestId)}`, {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      )
    },
  })

  const clearRequest = () => {
    setPendingUiRequest(null)
    setPendingUiValue("")
    setOpenState(false)
  }

  const resolveUiRequest = async (body: Record<string, unknown>) => {
    if (!viewerContextId || !pendingUiRequest) return

    try {
      await resolveUiRequestMutation.mutateAsync({
        requestId: pendingUiRequest.id,
        body,
      })
      clearRequest()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to resolve UI request"
      )
    }
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: (request) => {
        setPendingUiRequest(request)
        setPendingUiValue(request.prefill || "")
        setOpenState(true)
      },
      close: () => {
        clearRequest()
      },
      isOpen: () => openRef.current,
    }),
    [pendingUiRequest]
  )

  return (
    <AppShellUiRequestDialog
      pendingUiRequest={pendingUiRequest}
      pendingUiValue={pendingUiValue}
      onPendingUiValueChange={setPendingUiValue}
      onResolveUiRequest={(body) => {
        void resolveUiRequest(body)
      }}
    />
  )
}
