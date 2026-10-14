import * as React from "react"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { Outlet, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import { AppProviders } from "@/components/app-providers"

const TANSTACK_DEVTOOLS_SETTINGS_KEY = "tanstack_devtools_settings"
const TANSTACK_DEVTOOLS_DEFAULTS_STORAGE_KEY =
  "pico-tanstack-devtools-defaults-v2"
const TANSTACK_DEVTOOLS_CONFIG = {
  position: "bottom-right",
  openHotkey: ["Control", "Shift", "`"],
  triggerHidden: true,
} satisfies NonNullable<React.ComponentProps<typeof TanStackDevtools>["config"]>

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: RootNotFound,
})

function RootNotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="space-y-2 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you requested does not exist.
        </p>
      </div>
    </main>
  )
}

function RootComponent() {
  return (
    <AppProviders>
      <Outlet />
      <AppTanStackDevtools />
    </AppProviders>
  )
}

function subscribeTanStackDevtoolsReady() {
  return () => {}
}

function getTanStackDevtoolsReadySnapshot() {
  try {
    const defaultsApplied = window.localStorage.getItem(
      TANSTACK_DEVTOOLS_DEFAULTS_STORAGE_KEY
    )

    if (defaultsApplied !== "true") {
      const rawSettings = window.localStorage.getItem(
        TANSTACK_DEVTOOLS_SETTINGS_KEY
      )
      const parsedSettings = rawSettings
        ? (JSON.parse(rawSettings) as unknown)
        : undefined
      const existingSettings =
        parsedSettings &&
        typeof parsedSettings === "object" &&
        !Array.isArray(parsedSettings)
          ? parsedSettings
          : {}

      window.localStorage.setItem(
        TANSTACK_DEVTOOLS_SETTINGS_KEY,
        JSON.stringify({
          ...existingSettings,
          openHotkey: TANSTACK_DEVTOOLS_CONFIG.openHotkey,
          triggerHidden: TANSTACK_DEVTOOLS_CONFIG.triggerHidden,
        })
      )
      window.localStorage.setItem(
        TANSTACK_DEVTOOLS_DEFAULTS_STORAGE_KEY,
        "true"
      )
    }
  } catch {
    // Ignore unavailable localStorage or malformed persisted devtools settings.
  }

  return true
}

function getTanStackDevtoolsServerSnapshot() {
  return false
}

function AppTanStackDevtools() {
  const isReady = React.useSyncExternalStore(
    subscribeTanStackDevtoolsReady,
    getTanStackDevtoolsReadySnapshot,
    getTanStackDevtoolsServerSnapshot
  )

  if (!isReady) return null

  return (
    <TanStackDevtools
      config={TANSTACK_DEVTOOLS_CONFIG}
      plugins={[
        {
          name: "Tanstack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
      ]}
    />
  )
}
