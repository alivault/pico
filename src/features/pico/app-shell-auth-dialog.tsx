import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type {
  AuthMutationResponse,
  AuthProviderOption,
  AuthProvidersResponse,
} from "@/lib/pico/api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { useIsMobile } from "@/hooks/use-mobile"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"

export type AppShellAuthDialogHandle = {
  open: (
    mode?: "login" | "logout",
    options?: { returnOnClose?: () => void }
  ) => void
  close: () => void
  isOpen: () => boolean
}

type AppShellAuthDialogControllerProps = {
  ref?: React.Ref<AppShellAuthDialogHandle>
  openStateRef?: React.RefObject<boolean>
  viewerContextId: string
  sessionId?: string
}

function providerKey(provider: AuthProviderOption) {
  return `${provider.authType}:${provider.id}`
}

function providerKeywords(provider: AuthProviderOption) {
  return [
    provider.id,
    provider.name,
    provider.authType === "oauth" ? "oauth subscription login" : "api key",
    provider.configured ? "saved configured" : "",
    provider.source || "",
  ].filter(Boolean)
}

function providerDescription(provider: AuthProviderOption) {
  const kind =
    provider.authType === "oauth" ? "Subscription / OAuth" : "API key"
  return provider.source ? `${kind} · ${provider.source}` : kind
}

function AuthSurface({
  open,
  isMobile,
  title,
  description,
  children,
  onOpenChange,
}: {
  open: boolean
  isMobile: boolean
  title: string
  description: string
  children: React.ReactNode
  onOpenChange: (open: boolean) => void
}) {
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {children}
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
      {children}
    </CommandDialog>
  )
}

function ProviderCommandItem({
  provider,
  actionLabel,
  disabled,
  onSelect,
}: {
  provider: AuthProviderOption
  actionLabel: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <CommandItem
      value={providerKey(provider)}
      keywords={providerKeywords(provider)}
      disabled={disabled}
      onSelect={onSelect}
      className="items-start py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{provider.name}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {providerDescription(provider)}
        </span>
      </div>
      {provider.configured ? (
        <Badge variant="secondary" className="shrink-0">
          Saved
        </Badge>
      ) : (
        <CommandShortcut className="inline shrink-0 tracking-normal normal-case">
          {actionLabel}
        </CommandShortcut>
      )}
    </CommandItem>
  )
}

export function AppShellAuthDialogController({
  ref,
  openStateRef,
  viewerContextId,
  sessionId,
}: AppShellAuthDialogControllerProps) {
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [logoutOpen, setLogoutOpen] = React.useState(false)
  const [apiKeyOpen, setApiKeyOpen] = React.useState(false)
  const [selectedApiKeyProvider, setSelectedApiKeyProvider] =
    React.useState<AuthProviderOption | null>(null)
  const [apiKey, setApiKey] = React.useState("")
  const openRef = React.useRef(false)
  const returnOnCloseRef = React.useRef<(() => void) | null>(null)

  const authDialogOpen = loginOpen || logoutOpen || apiKeyOpen

  React.useLayoutEffect(() => {
    openRef.current = authDialogOpen
    if (openStateRef) {
      openStateRef.current = authDialogOpen
    }
  }, [authDialogOpen, openStateRef])

  const closeApiKeyDialog = () => {
    setApiKeyOpen(false)
    setSelectedApiKeyProvider(null)
    setApiKey("")
  }

  const backToLoginProviders = () => {
    closeApiKeyDialog()
    setLoginOpen(true)
  }

  const closeAllDialogs = (options?: { returnToOrigin?: boolean }) => {
    setLoginOpen(false)
    setLogoutOpen(false)
    closeApiKeyDialog()

    const returnOnClose = returnOnCloseRef.current
    returnOnCloseRef.current = null
    if (options?.returnToOrigin && returnOnClose) {
      returnOnClose()
    }
  }

  const closeAndReturnToOrigin = () => {
    closeAllDialogs({ returnToOrigin: true })
  }

  const providersQuery = useQuery({
    queryKey: ["pico", "auth", "providers", viewerContextId, sessionId],
    enabled: authDialogOpen && Boolean(viewerContextId),
    queryFn: async () => {
      return await fetchJson<AuthProvidersResponse>(
        buildRequestUrl("/api/auth/providers", {
          contextId: viewerContextId,
          sessionId,
        })
      )
    },
  })

  const apiKeyMutation = useMutation({
    mutationFn: async ({
      provider,
      key,
    }: {
      provider: string
      key: string
    }) => {
      return await fetchJson<AuthMutationResponse>(
        buildRequestUrl("/api/auth/api-key", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, key }),
        }
      )
    },
    onSuccess: async (_response, variables) => {
      toast.success(`Saved API key for ${variables.provider}`)
      await queryClient.invalidateQueries({
        queryKey: ["pico", "auth", "providers", viewerContextId, sessionId],
      })
      closeAllDialogs()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save API key"
      )
    },
  })

  const oauthMutation = useMutation({
    mutationFn: async ({ provider }: { provider: string }) => {
      return await fetchJson<AuthMutationResponse>(
        buildRequestUrl("/api/auth/oauth", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
        }
      )
    },
    onSuccess: async (_response, variables) => {
      toast.success(`Logged in to ${variables.provider}`)
      await queryClient.invalidateQueries({
        queryKey: ["pico", "auth", "providers", viewerContextId, sessionId],
      })
      closeAllDialogs()
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Login failed"
      if (message === "Login cancelled") return
      toast.error(message)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async ({ provider }: { provider: string }) => {
      return await fetchJson<AuthMutationResponse>(
        buildRequestUrl("/api/auth/logout", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
        }
      )
    },
    onSuccess: async (_response, variables) => {
      toast.success(`Logged out of ${variables.provider}`)
      await queryClient.invalidateQueries({
        queryKey: ["pico", "auth", "providers", viewerContextId, sessionId],
      })
      closeAllDialogs()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Logout failed")
    },
  })

  React.useImperativeHandle(
    ref,
    () => ({
      open: (mode = "login", options) => {
        if (options?.returnOnClose) {
          returnOnCloseRef.current = options.returnOnClose
        }
        closeApiKeyDialog()
        if (mode === "logout") {
          setLoginOpen(false)
          setLogoutOpen(true)
        } else {
          setLogoutOpen(false)
          setLoginOpen(true)
        }
      },
      close: () => closeAllDialogs(),
      isOpen: () => openRef.current,
    }),
    []
  )

  const data = providersQuery.data?.ok ? providersQuery.data : undefined
  const oauthProviders = data?.oauthProviders ?? []
  const apiKeyProviders = data?.apiKeyProviders ?? []
  const loggedInProviders = data?.loggedInProviders ?? []

  const selectLoginProvider = (provider: AuthProviderOption) => {
    if (provider.authType === "oauth") {
      setLoginOpen(false)
      oauthMutation.mutate({ provider: provider.id })
      return
    }

    setSelectedApiKeyProvider(provider)
    setApiKey("")
    setLoginOpen(false)
    setApiKeyOpen(true)
  }

  const submitApiKey = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedApiKeyProvider || !apiKey.trim()) return
    apiKeyMutation.mutate({
      provider: selectedApiKeyProvider.id,
      key: apiKey,
    })
  }

  const loginCommandBody = (
    <Command loop shouldFilter className="min-h-0 flex-1">
      <CommandInput
        placeholder="Search login providers"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>
          {providersQuery.isLoading
            ? "Loading providers…"
            : providersQuery.isError
              ? providersQuery.error instanceof Error
                ? providersQuery.error.message
                : "Failed to load providers"
              : "No auth providers found."}
        </CommandEmpty>
        {oauthProviders.length > 0 && (
          <CommandGroup heading="Subscriptions / OAuth">
            {oauthProviders.map((provider) => (
              <ProviderCommandItem
                key={providerKey(provider)}
                provider={provider}
                actionLabel="Login"
                onSelect={() => selectLoginProvider(provider)}
              />
            ))}
          </CommandGroup>
        )}
        {apiKeyProviders.length > 0 && (
          <CommandGroup heading="API keys">
            {apiKeyProviders.map((provider) => (
              <ProviderCommandItem
                key={providerKey(provider)}
                provider={provider}
                actionLabel="Set key"
                onSelect={() => selectLoginProvider(provider)}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {isMobile ? (
        <div className="border-t border-border/70 p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={closeAndReturnToOrigin}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
          Use ↑/↓ to select, Enter to start login or enter an API key, and Esc
          to {returnOnCloseRef.current ? "go back" : "close"}.
        </div>
      )}
    </Command>
  )

  const logoutCommandBody = (
    <Command loop shouldFilter className="min-h-0 flex-1">
      <CommandInput
        placeholder="Search logged-in providers"
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>
          {providersQuery.isLoading
            ? "Loading providers…"
            : providersQuery.isError
              ? providersQuery.error instanceof Error
                ? providersQuery.error.message
                : "Failed to load providers"
              : "No providers are currently logged in."}
        </CommandEmpty>
        {loggedInProviders.length > 0 && (
          <CommandGroup heading="Logged in providers">
            {loggedInProviders.map((provider) => (
              <ProviderCommandItem
                key={providerKey(provider)}
                provider={provider}
                actionLabel="Logout"
                disabled={logoutMutation.isPending}
                onSelect={() => {
                  if (logoutMutation.isPending) return
                  setLogoutOpen(false)
                  logoutMutation.mutate({ provider: provider.id })
                }}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {isMobile ? (
        <div className="border-t border-border/70 p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={closeAndReturnToOrigin}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="hidden border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:block">
          Use ↑/↓ to select, Enter to remove credentials, and Esc to{" "}
          {returnOnCloseRef.current ? "go back" : "close"}.
        </div>
      )}
    </Command>
  )

  const apiKeyCommandBody = (
    <form
      onSubmit={submitApiKey}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          backToLoginProviders()
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={backToLoginProviders}
          aria-label="Back to login providers"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {selectedApiKeyProvider
              ? `Set ${selectedApiKeyProvider.name} API key`
              : "Set provider API key"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            The key is saved to pi auth storage, not the browser.
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            selectedApiKeyProvider
              ? `Enter ${selectedApiKeyProvider.name} API key`
              : "Enter API key"
          }
          autoComplete="off"
          className="min-w-0 flex-1"
        />
      </div>
      {isMobile ? (
        <div className="border-t border-border/70 p-3">
          <Button
            type="submit"
            className="w-full"
            disabled={apiKeyMutation.isPending || !apiKey.trim()}
          >
            {apiKeyMutation.isPending ? "Saving…" : "Save API key"}
          </Button>
        </div>
      ) : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <Kbd>Enter</Kbd>
            Save
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd>
            Back
          </span>
        </div>
      )}
    </form>
  )

  return (
    <>
      <AuthSurface
        open={loginOpen}
        isMobile={isMobile}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeAndReturnToOrigin()
          else setLoginOpen(true)
        }}
        title="Login to provider"
        description="Search providers and press Enter to configure authentication."
      >
        {loginCommandBody}
      </AuthSurface>
      <AuthSurface
        open={logoutOpen}
        isMobile={isMobile}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeAndReturnToOrigin()
          else setLogoutOpen(true)
        }}
        title="Logout from provider"
        description="Search saved provider credentials and press Enter to remove them."
      >
        {logoutCommandBody}
      </AuthSurface>
      <AuthSurface
        open={apiKeyOpen}
        isMobile={isMobile}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) backToLoginProviders()
          else setApiKeyOpen(true)
        }}
        title={
          selectedApiKeyProvider
            ? `Set ${selectedApiKeyProvider.name} API key`
            : "Set provider API key"
        }
        description="Enter an API key to save it to pi auth storage."
      >
        {apiKeyCommandBody}
      </AuthSurface>
    </>
  )
}
