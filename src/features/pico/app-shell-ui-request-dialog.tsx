import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ExtensionUiEvent, UiRequestResponse } from "@/lib/pico/api"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useIsMobile } from "@/hooks/use-mobile"

type AppShellUiRequestDialogProps = {
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
  onAuthBack?: () => void
}

function AppShellUiRequestDialog({
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
  onAuthBack,
}: AppShellUiRequestDialogProps) {
  const isMobile = useIsMobile()
  const [authManualMode, setAuthManualMode] = React.useState(false)

  React.useEffect(() => {
    setAuthManualMode(false)
  }, [pendingUiRequest?.id])

  const renderAuthSurface = (
    open: boolean,
    onOpenChange: (open: boolean) => void,
    title: string,
    description: string,
    body: React.ReactNode
  ) => {
    if (isMobile) {
      return (
        <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
          <DrawerContent className="max-h-[90svh] overflow-hidden">
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{description}</DrawerDescription>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
              {body}
            </div>
          </DrawerContent>
        </Drawer>
      )
    }

    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        className="sm:max-w-xl"
        initialFocus
      >
        {body}
      </CommandDialog>
    )
  }

  if (pendingUiRequest?.method === "auth" && pendingUiRequest.authUrl) {
    const cancelAuthAndReturn = () => {
      onResolveUiRequest({ cancelled: true })
      onAuthBack?.()
    }

    if (authManualMode) {
      return renderAuthSurface(
        true,
        (open) => {
          if (!open) setAuthManualMode(false)
        },
        "Paste redirect URL",
        "Paste the final redirected URL from the browser address bar.",
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (!pendingUiValue.trim()) return
            onResolveUiRequest({ value: pendingUiValue })
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setAuthManualMode(false)
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setAuthManualMode(false)}
              aria-label="Back to login actions"
            >
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                Paste redirect URL
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Fallback only: paste the full localhost callback URL.
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center p-3">
            <Input
              value={pendingUiValue}
              onChange={(event) => onPendingUiValueChange(event.target.value)}
              placeholder="Final redirected URL"
              className="min-w-0 flex-1"
            />
          </div>
          {isMobile ? (
            <div className="border-t border-border/70 p-3">
              <Button
                type="submit"
                className="w-full"
                disabled={!pendingUiValue.trim()}
              >
                Submit URL
              </Button>
            </div>
          ) : (
            <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
              <span className="inline-flex items-center gap-1">
                <Kbd>Enter</Kbd>
                Submit URL
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd>
                Back
              </span>
            </div>
          )}
        </form>
      )
    }

    return renderAuthSurface(
      true,
      (open) => {
        if (!open) cancelAuthAndReturn()
      },
      pendingUiRequest.title || "Log in to provider",
      pendingUiRequest.message ||
        "Open the login page, then complete login in your browser.",
      <Command loop shouldFilter>
        <CommandInput
          placeholder="Choose login action"
          className="text-base md:text-sm"
        />
        <CommandList>
          <CommandGroup heading={pendingUiRequest.title || "Provider login"}>
            <CommandItem
              value="open-login-page"
              keywords={["open", "browser", "login", "page"]}
              onSelect={() => {
                window.open(
                  pendingUiRequest.authUrl,
                  "_blank",
                  "noopener,noreferrer"
                )
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">Open login page</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  Continue OAuth in your browser. Keep Pico open while the
                  provider redirects back.
                </span>
              </div>
              <CommandShortcut className="inline shrink-0 tracking-normal normal-case">
                Enter
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              value="copy-login-link"
              keywords={["copy", "link", "url", "login"]}
              onSelect={() => {
                void navigator.clipboard.writeText(pendingUiRequest.authUrl!)
                toast.success("Login link copied")
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">Copy login link</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  Copy the browser login link without showing the full URL.
                </span>
              </div>
            </CommandItem>
            {pendingUiRequest.authManualAllowed && (
              <CommandItem
                value="paste-redirect-url"
                keywords={["paste", "redirect", "manual", "fallback"]}
                onSelect={() => {
                  onPendingUiValueChange("")
                  setAuthManualMode(true)
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    Paste redirect URL manually
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    Fallback only: use this if the browser reaches a localhost
                    callback URL but cannot connect.
                  </span>
                </div>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
        {isMobile ? (
          <div className="border-t border-border/70 p-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={cancelAuthAndReturn}
            >
              Cancel login
            </Button>
          </div>
        ) : (
          <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
            Use ↑/↓ to select, Enter to run an action, and Esc to go back.
          </div>
        )}
      </Command>
    )
  }

  if (pendingUiRequest?.method === "auth_select") {
    const cancelAuthAndReturn = () => {
      onResolveUiRequest({ cancelled: true })
      onAuthBack?.()
    }
    const options = pendingUiRequest.options ?? []

    return renderAuthSurface(
      true,
      (open) => {
        if (!open) cancelAuthAndReturn()
      },
      pendingUiRequest.title || "Log in to provider",
      pendingUiRequest.message || "Choose how to continue login.",
      <Command loop shouldFilter>
        <CommandInput
          placeholder="Choose login option"
          className="text-base md:text-sm"
        />
        <CommandList>
          <CommandGroup heading={pendingUiRequest.message || "Login options"}>
            {options.map((option) => {
              const value = typeof option === "string" ? option : option.value
              const label =
                typeof option === "string"
                  ? option
                  : option.label || option.value
              return (
                <CommandItem
                  key={value}
                  value={value}
                  keywords={[label]}
                  onSelect={() => onResolveUiRequest({ value })}
                >
                  <span className="truncate font-medium">{label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
        {isMobile ? (
          <div className="border-t border-border/70 p-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={cancelAuthAndReturn}
            >
              Cancel login
            </Button>
          </div>
        ) : (
          <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
            Use ↑/↓ to select, Enter to continue, and Esc to go back.
          </div>
        )}
      </Command>
    )
  }

  if (pendingUiRequest?.method === "auth_input") {
    const allowEmpty = Boolean(pendingUiRequest.allowEmpty)
    const cancelAuthAndReturn = () => {
      onResolveUiRequest({ cancelled: true })
      onAuthBack?.()
    }

    return renderAuthSurface(
      true,
      (open) => {
        if (!open) cancelAuthAndReturn()
      },
      pendingUiRequest.title || "Log in to provider",
      pendingUiRequest.message || "Enter the requested login information.",
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          if (!allowEmpty && !pendingUiValue.trim()) return
          onResolveUiRequest({ value: pendingUiValue })
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            cancelAuthAndReturn()
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={cancelAuthAndReturn}
            aria-label="Back to login providers"
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {pendingUiRequest.title || "Log in to provider"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {pendingUiRequest.message ||
                "Enter the requested login information."}
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center p-3">
          <Input
            value={pendingUiValue}
            onChange={(event) => onPendingUiValueChange(event.target.value)}
            placeholder={pendingUiRequest.placeholder}
            className="min-w-0 flex-1"
          />
        </div>
        {isMobile ? (
          <div className="space-y-2 border-t border-border/70 p-3">
            <Button
              type="submit"
              className="w-full"
              disabled={!allowEmpty && !pendingUiValue.trim()}
            >
              Continue login
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={cancelAuthAndReturn}
            >
              Cancel login
            </Button>
          </div>
        ) : (
          <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>Enter</Kbd>
              Continue login
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd>
              Back
            </span>
          </div>
        )}
      </form>
    )
  }

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
          <DialogTitle>{pendingUiRequest?.title || "Pico request"}</DialogTitle>
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
              Submit response
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
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
  sessionId?: string
  onAuthBack?: () => void
}

export function AppShellUiRequestDialogController({
  ref,
  openStateRef,
  viewerContextId,
  sessionId,
  onAuthBack,
}: AppShellUiRequestDialogControllerProps) {
  const [pendingUiRequest, setPendingUiRequest] =
    React.useState<ExtensionUiEvent | null>(null)
  const [pendingUiValue, setPendingUiValue] = React.useState("")
  const openRef = React.useRef(false)
  const pendingUiRequestRef = React.useRef<ExtensionUiEvent | null>(null)

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

  const clearRequest = (requestId?: string) => {
    if (requestId && pendingUiRequestRef.current?.id !== requestId) return
    pendingUiRequestRef.current = null
    setPendingUiRequest(null)
    setPendingUiValue("")
    setOpenState(false)
  }

  const resolveUiRequest = async (body: Record<string, unknown>) => {
    if (!viewerContextId || !pendingUiRequest) return

    const requestId = pendingUiRequest.id
    try {
      await resolveUiRequestMutation.mutateAsync({
        requestId,
        body,
      })
      clearRequest(requestId)
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
        pendingUiRequestRef.current = request
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
      onAuthBack={onAuthBack}
    />
  )
}
