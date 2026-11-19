/**
 * The Preview of the Browser tab: a dev server of the machine, such as
 * `localhost:5173`, in an iframe. The hub shows it on its own port
 * (server/src/services/preview-proxy.ts), so the page is real: it scrolls,
 * selects, and reloads as in a browser tab, and hot reload works.
 */
import * as React from "react"
import { ExternalLinkIcon, MonitorIcon, RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { fetchJson } from "@/features/pico/app-shell-utils"
import { emitPicoEvent, type PicoEventMap } from "@/features/pico/agent/events"
import { useMachineReadOnly } from "@/features/pico/machine-store"
import { useMachineId } from "@/lib/pico/machine-context"
import { hubUrl, isRemoteMachine } from "@/lib/pico/machine"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"

export type BrowserMode = "preview" | "agent"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"])

/**
 * A dev server address: a port ("5173"), a host and port
 * ("localhost:5173/app"), or a URL ("http://127.0.0.1:3000/?a=1"). Only
 * this machine's own addresses; undefined for others.
 */
export function parsePreviewAddress(text: string) {
  const value = text.trim()
  if (!value) return undefined
  if (/^\d{1,5}$/.test(value)) {
    const port = Number(value)
    return port > 0 && port < 65536 ? { port, path: "/" } : undefined
  }
  let url: URL
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
    )
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80))
  return { port, path: `${url.pathname}${url.search}${url.hash}` }
}

/** The address as the field shows it, as "localhost:5173/app". */
function formatAddress({ port, path }: { port: number; path: string }) {
  return `localhost:${port}${path === "/" ? "" : path}`
}

// Window events, so that all views of a key update together.
const STORAGE_EVENT = "pico:preview-storage"

function useStoredValue(key: string) {
  const subscribe = (listener: () => void) => {
    const onStorage = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== key) return
      listener()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(STORAGE_EVENT, onStorage)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(STORAGE_EVENT, onStorage)
    }
  }
  return React.useSyncExternalStore(
    subscribe,
    () => safeLocalStorageGetItem(key) ?? "",
    () => ""
  )
}

function storeValue(key: string, value: string) {
  safeLocalStorageSetItem(key, value)
  window.dispatchEvent(new Event(STORAGE_EVENT))
}

function previewAddressKey(machineId: string, cwd: string) {
  return `pico-preview-address:${machineId}:${cwd}`
}

function browserModeKey(machineId: string) {
  return `pico-browser-mode:${machineId}`
}

/** Save the preview address of a project, as an agent's dev server. */
export function setPreviewAddress(
  machineId: string,
  cwd: string,
  address: { port: number; path: string }
) {
  storeValue(previewAddressKey(machineId, cwd), formatAddress(address))
}

/**
 * Save a dev server as the project's preview address and tell the shell of
 * its machine. With `open`, the user asked for it: the shell shows the
 * Preview always.
 */
export function showPreview(detail: PicoEventMap["pico:preview-available"]) {
  setPreviewAddress(detail.machineId, detail.cwd, detail)
  emitPicoEvent("pico:preview-available", detail)
}

/**
 * The URL of a dev server of a machine for this browser. The hub shows it on
 * its own port (`/api/preview/open`).
 */
export async function previewUrl(
  machineId: string,
  address: { port: number; path: string }
) {
  const response = await fetchJson<
    { ok: true; port: number } | { ok: false; error: string }
  >(hubUrl("/api/preview/open"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineId, port: address.port }),
  })
  if (!response.ok) throw new Error(response.error)
  return `${window.location.protocol}//${window.location.hostname}:${response.port}${address.path}`
}

/**
 * The direct URL of a dev server, when this browser runs on its machine:
 * the local machine, with Pico open on a loopback address.
 */
export function directPreviewUrl(
  machineId: string,
  address: { port: number; path: string }
) {
  if (isRemoteMachine(machineId)) return undefined
  if (!LOOPBACK_HOSTS.has(window.location.hostname)) return undefined
  return `http://localhost:${address.port}${address.path}`
}

/** The saved preview address of a project, or "". */
export function usePreviewAddress(machineId: string, cwd: string) {
  return useStoredValue(previewAddressKey(machineId, cwd))
}

/** What the Browser tab shows: the Preview or the agent's browser. */
export function useBrowserMode(machineId: string): BrowserMode | undefined {
  const value = useStoredValue(browserModeKey(machineId))
  return value === "preview" || value === "agent" ? value : undefined
}

export function setBrowserMode(machineId: string, mode: BrowserMode) {
  storeValue(browserModeKey(machineId), mode)
}

type OpenedPreview = { src: string; address: string }

export function PreviewPanel({ cwd }: { cwd: string }) {
  const machineId = useMachineId()
  const readOnly = useMachineReadOnly()
  const savedAddress = usePreviewAddress(machineId, cwd)
  const [address, setAddress] = React.useState(savedAddress)
  const [opened, setOpened] = React.useState<OpenedPreview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  // A new key loads the iframe again.
  const [reloads, setReloads] = React.useState(0)
  // The address that the iframe shows or loads.
  const loadedAddressRef = React.useRef("")

  const open = React.useCallback(
    async (text: string) => {
      const parsed = parsePreviewAddress(text)
      if (!parsed) {
        setError(
          "Enter a port or a local address, as 5173 or localhost:5173. The Preview shows dev servers of this machine."
        )
        return
      }
      const formatted = formatAddress(parsed)
      loadedAddressRef.current = formatted
      setLoading(true)
      setError("")
      try {
        const src = await previewUrl(machineId, parsed)
        setAddress(formatted)
        storeValue(previewAddressKey(machineId, cwd), formatted)
        setOpened({ src, address: formatted })
        setReloads((count) => count + 1)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setLoading(false)
      }
    },
    [cwd, machineId]
  )

  // Show the saved address of the project when the panel opens, and a new
  // one, as the dev server that an agent started.
  const projectRef = React.useRef("")
  React.useEffect(() => {
    const project = `${machineId}:${cwd}`
    if (projectRef.current !== project) {
      projectRef.current = project
      loadedAddressRef.current = ""
      setOpened(null)
      setError("")
      setAddress(savedAddress)
    }
    if (savedAddress && savedAddress !== loadedAddressRef.current)
      void open(savedAddress)
  }, [cwd, machineId, open, savedAddress])

  const httpsPage = window.location.protocol === "https:"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 p-1.5">
        <TitleTooltip title="Reload">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Reload"
            disabled={!opened || readOnly}
            onClick={() => setReloads((count) => count + 1)}
          >
            <RotateCwIcon />
          </Button>
        </TitleTooltip>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            void open(address)
            const field = event.currentTarget.elements.namedItem("address")
            if (field instanceof HTMLInputElement) field.blur()
          }}
        >
          <Input
            aria-label="Dev server address"
            name="address"
            placeholder="Port of a dev server, as 5173"
            className="h-7 text-xs"
            disabled={readOnly}
            value={address}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <TitleTooltip title="Open in a new tab">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open in a new tab"
            disabled={!opened}
            render={
              opened ? (
                <a
                  href={opened.src}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ) : undefined
            }
          >
            <ExternalLinkIcon />
          </Button>
        </TitleTooltip>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col bg-muted/30">
        {opened ? (
          <iframe
            key={`${opened.src}:${reloads}`}
            src={opened.src}
            title={`Preview of ${opened.address}`}
            className="min-h-0 w-full flex-1 border-0 bg-white"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
            <MonitorIcon className="size-6" />
            <span className="max-w-xs">
              Enter the port of a dev server on this machine to see your app, as
              5173 or localhost:3000.
            </span>
            {httpsPage ? (
              <span className="max-w-xs text-xs">
                This page uses HTTPS, so the browser can block a preview over
                HTTP. Open Pico over HTTP to use the Preview.
              </span>
            ) : null}
          </div>
        )}
        {error ? (
          <div className="absolute inset-x-2 bottom-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
