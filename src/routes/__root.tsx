import * as React from "react"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"

import { AppProviders } from "@/components/app-providers"

import appCss from "../styles.css?url"

const TANSTACK_DEVTOOLS_SETTINGS_KEY = "tanstack_devtools_settings"
const TANSTACK_DEVTOOLS_DEFAULTS_STORAGE_KEY =
  "pico-tanstack-devtools-defaults-v1"
const TANSTACK_DEVTOOLS_CONFIG = {
  position: "bottom-right",
  openHotkey: ["Control", "`"],
  triggerHidden: true,
} satisfies NonNullable<React.ComponentProps<typeof TanStackDevtools>["config"]>

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Pico",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "alternate icon",
        type: "image/png",
        href: "/favicon.png",
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
  }),
  shellComponent: RootDocument,
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

function RootDocument({ children }: { children: React.ReactNode }) {
  const reactScanScriptSrc =
    import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true"
      ? "/src/react-scan-dev.ts"
      : undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {reactScanScriptSrc ? (
          <script type="module" src={reactScanScriptSrc} />
        ) : null}
      </head>
      <body className="h-svh overflow-hidden bg-background text-foreground antialiased">
        <AppProviders>
          {children}
          <AppTanStackDevtools />
        </AppProviders>
        <Scripts />
      </body>
    </html>
  )
}

function AppTanStackDevtools() {
  const [isReady, setIsReady] = React.useState(false)

  React.useEffect(() => {
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

    setIsReady(true)
  }, [])

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
