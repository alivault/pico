/**
 * The Preview of the Browser tab: a dev server of the machine, such as
 * `localhost:5173`, in an iframe. The hub shows it on its own port
 * (server/src/services/preview-proxy.ts), so the page is real: it scrolls,
 * selects, and reloads as in a browser tab, and hot reload works.
 */
import * as React from "react"
import {
  ExternalLinkIcon,
  MonitorIcon,
  RotateCwIcon,
  RotateCwSquareIcon,
  RulerDimensionLineIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

function previewViewportKey(machineId: string, cwd: string) {
  return `pico-preview-viewport:${machineId}:${cwd}`
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
 * its own port (`/api/preview/open`). Over Tailscale HTTPS, the hub gives the
 * origin to load (a Tailscale Serve port); else it is the page host.
 */
export async function previewUrl(
  machineId: string,
  address: { port: number; path: string }
) {
  const response = await fetchJson<
    { ok: true; port: number; url?: string } | { ok: false; error: string }
  >(hubUrl("/api/preview/open"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineId, port: address.port }),
  })
  if (!response.ok) throw new Error(response.error)
  const origin =
    response.url ??
    `${window.location.protocol}//${window.location.hostname}:${response.port}`
  return `${origin}${address.path}`
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

type ViewportMode = "fit" | "mobile" | "tablet" | "custom"
type ViewportSize = { width: number; height: number }

/**
 * The viewport of the Preview. "fit" fills the pane; the other modes give
 * the iframe a fixed CSS size. `rotated` swaps the size of a preset; a
 * custom size is swapped in `custom`.
 */
type ViewportSetting = {
  mode: ViewportMode
  rotated: boolean
  custom: ViewportSize
}

const VIEWPORT_PRESETS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
} satisfies Record<string, ViewportSize>

const VIEWPORT_CHOICES: {
  mode: ViewportMode
  label: string
  icon: typeof MonitorIcon
}[] = [
  { mode: "fit", label: "Fit", icon: MonitorIcon },
  { mode: "mobile", label: "Mobile", icon: SmartphoneIcon },
  { mode: "tablet", label: "Tablet", icon: TabletIcon },
  { mode: "custom", label: "Custom", icon: RulerDimensionLineIcon },
]

const VIEWPORT_MIN = 200
const VIEWPORT_MAX = 3000

const DEFAULT_VIEWPORT: ViewportSetting = {
  mode: "fit",
  rotated: false,
  custom: { width: 1280, height: 800 },
}

function clampViewportLength(value: number) {
  return Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, Math.round(value)))
}

function parseViewport(text: string): ViewportSetting {
  if (!text) return DEFAULT_VIEWPORT
  try {
    const value = JSON.parse(text) as Partial<ViewportSetting> | null
    const mode = VIEWPORT_CHOICES.some((choice) => choice.mode === value?.mode)
      ? (value?.mode as ViewportMode)
      : "fit"
    const width = Number(value?.custom?.width)
    const height = Number(value?.custom?.height)
    return {
      mode,
      rotated: value?.rotated === true,
      custom:
        Number.isFinite(width) && Number.isFinite(height)
          ? {
              width: clampViewportLength(width),
              height: clampViewportLength(height),
            }
          : DEFAULT_VIEWPORT.custom,
    }
  } catch {
    return DEFAULT_VIEWPORT
  }
}

/** The CSS size of the iframe, or undefined when it fills the pane. */
function viewportSize(setting: ViewportSetting): ViewportSize | undefined {
  if (setting.mode === "fit") return undefined
  if (setting.mode === "custom") return setting.custom
  const size = VIEWPORT_PRESETS[setting.mode]
  return setting.rotated ? { width: size.height, height: size.width } : size
}

function rotateViewport(setting: ViewportSetting): ViewportSetting {
  if (setting.mode === "custom")
    return {
      ...setting,
      custom: { width: setting.custom.height, height: setting.custom.width },
    }
  return { ...setting, rotated: !setting.rotated }
}

/** The viewport of a project's Preview, saved per machine and cwd. */
function usePreviewViewport(machineId: string, cwd: string) {
  const key = previewViewportKey(machineId, cwd)
  const stored = useStoredValue(key)
  const setting = React.useMemo(() => parseViewport(stored), [stored])
  const setSetting = React.useCallback(
    (next: ViewportSetting) => storeValue(key, JSON.stringify(next)),
    [key]
  )
  return [setting, setSetting] as const
}

/**
 * The inner size of an element, kept current with a ResizeObserver. Give
 * the returned callback ref to the element.
 */
function useElementSize() {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  const [size, setSize] = React.useState<ViewportSize>({ width: 0, height: 0 })
  React.useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, size] as const
}

/** A number field of a custom viewport size. It saves on Enter and blur. */
function ViewportLengthInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = React.useState(String(value))
  React.useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const number = Number(draft)
    if (draft.trim() === "" || !Number.isFinite(number)) {
      setDraft(String(value))
      return
    }
    const next = clampViewportLength(number)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }
  return (
    <Input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={VIEWPORT_MIN}
      max={VIEWPORT_MAX}
      className="h-5 w-14 [appearance:textfield] px-1 py-0 text-center text-xs tabular-nums md:text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      disabled={disabled}
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        } else if (event.key === "Escape") {
          setDraft(String(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function PreviewPanel({ cwd }: { cwd: string }) {
  const machineId = useMachineId()
  const readOnly = useMachineReadOnly()
  const savedAddress = usePreviewAddress(machineId, cwd)
  const [address, setAddress] = React.useState(savedAddress)
  const [opened, setOpened] = React.useState<OpenedPreview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [viewport, setViewport] = usePreviewViewport(machineId, cwd)
  const fixedSize = viewportSize(viewport)
  const [stageRef, stage] = useElementSize()
  // Scale a fixed size down so that the frame and its 1px border fit.
  const scale =
    fixedSize && stage.width > 0 && stage.height > 0
      ? Math.min(
          1,
          (stage.width - 2) / fixedSize.width,
          (stage.height - 2) / fixedSize.height
        )
      : 1
  const scalePercent = Math.round(scale * 100)
  const viewportChoice =
    VIEWPORT_CHOICES.find((choice) => choice.mode === viewport.mode) ??
    VIEWPORT_CHOICES[0]
  const ViewportIcon = viewportChoice.icon
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

  // Over Tailscale HTTPS, the hub serves previews over HTTPS too.
  const httpsPage =
    window.location.protocol === "https:" &&
    !window.location.hostname.endsWith(".ts.net")

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
        <DropdownMenu>
          <TitleTooltip title={`Viewport: ${viewportChoice.label}`}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Viewport: ${viewportChoice.label}`}
                />
              }
            >
              <ViewportIcon />
            </DropdownMenuTrigger>
          </TitleTooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuRadioGroup
              value={viewport.mode}
              onValueChange={(value) =>
                setViewport({ ...viewport, mode: value as ViewportMode })
              }
            >
              {VIEWPORT_CHOICES.map((choice) => {
                const size =
                  choice.mode === "fit"
                    ? undefined
                    : viewportSize({ ...viewport, mode: choice.mode })
                return (
                  <DropdownMenuRadioItem
                    key={choice.mode}
                    value={choice.mode}
                    closeOnClick
                  >
                    <choice.icon />
                    {choice.label}
                    {size ? (
                      <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {size.width} × {size.height}
                      </span>
                    ) : null}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!fixedSize}
              onClick={() => setViewport(rotateViewport(viewport))}
            >
              <RotateCwSquareIcon />
              Rotate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      {opened && fixedSize ? (
        <div className="flex h-7 shrink-0 items-center justify-center gap-1 border-b border-border/70 px-2 text-xs text-muted-foreground tabular-nums">
          {viewport.mode === "custom" ? (
            <>
              <ViewportLengthInput
                label="Viewport width"
                value={fixedSize.width}
                disabled={readOnly}
                onCommit={(width) =>
                  setViewport({
                    ...viewport,
                    custom: { ...viewport.custom, width },
                  })
                }
              />
              <span>×</span>
              <ViewportLengthInput
                label="Viewport height"
                value={fixedSize.height}
                disabled={readOnly}
                onCommit={(height) =>
                  setViewport({
                    ...viewport,
                    custom: { ...viewport.custom, height },
                  })
                }
              />
            </>
          ) : (
            <span>
              {fixedSize.width} × {fixedSize.height}
            </span>
          )}
          {scalePercent < 100 ? <span>· {scalePercent}%</span> : null}
          <TitleTooltip title="Rotate">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Rotate"
              onClick={() => setViewport(rotateViewport(viewport))}
            >
              <RotateCwSquareIcon />
            </Button>
          </TitleTooltip>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col bg-muted/30">
        {opened ? (
          // The same tree for all viewports, so that a change of the
          // viewport does not load the page again.
          <div
            ref={stageRef}
            className={
              fixedSize
                ? "flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
            <div
              className={
                fixedSize
                  ? "box-content shrink-0 overflow-hidden rounded-md border border-border bg-white shadow-sm"
                  : "flex min-h-0 flex-1 flex-col"
              }
              style={
                fixedSize
                  ? {
                      width: fixedSize.width * scale,
                      height: fixedSize.height * scale,
                    }
                  : undefined
              }
            >
              <iframe
                key={`${opened.src}:${reloads}`}
                src={opened.src}
                title={`Preview of ${opened.address}`}
                className={
                  fixedSize
                    ? "block origin-top-left border-0 bg-white"
                    : "min-h-0 w-full flex-1 border-0 bg-white"
                }
                style={
                  fixedSize
                    ? {
                        width: fixedSize.width,
                        height: fixedSize.height,
                        transform: scale < 1 ? `scale(${scale})` : undefined,
                      }
                    : undefined
                }
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            </div>
          </div>
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
