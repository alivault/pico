/**
 * The Preview of the Browser tab: a dev server of the machine, such as
 * `localhost:5173`, in an iframe. The hub shows it on its own port
 * (server/src/services/preview-proxy.ts), so the page is real: it scrolls,
 * selects, and reloads as in a browser tab, and hot reload works.
 */
import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
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
import { fetchJson } from "@/features/smith/app-shell-utils"
import {
  emitSmithEvent,
  type SmithEventMap,
} from "@/features/smith/agent/events"
import { useMachineReadOnly } from "@/features/smith/machine-store"
import { useMachineId } from "@/lib/smith/machine-context"
import { hubUrl, isRemoteMachine } from "@/lib/smith/machine"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/smith/storage"

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
const STORAGE_EVENT = "smith:preview-storage"

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
  return `smith-preview-address:${machineId}:${cwd}`
}

function previewViewportKey(machineId: string, cwd: string) {
  return `smith-preview-viewport:${machineId}:${cwd}`
}

function browserModeKey(machineId: string) {
  return `smith-browser-mode:${machineId}`
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
export function showPreview(detail: SmithEventMap["smith:preview-available"]) {
  setPreviewAddress(detail.machineId, detail.cwd, detail)
  emitSmithEvent("smith:preview-available", detail)
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
 * the local machine, with Smith open on a loopback address.
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

type OpenedPreview = { src: string; address: string; port: number }

/**
 * The toolbar row of a Browser view. It is one row when the panel is wide
 * enough; in a narrow panel, the address field goes to a second row. The
 * panel (`BrowserPanel`) is the `browser` container.
 */
export const BROWSER_TOOLBAR_CLASS =
  "flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 p-1.5"

/** The address form in a toolbar row. */
export const BROWSER_ADDRESS_CLASS =
  "order-last min-w-0 basis-full @min-[400px]/browser:order-none @min-[400px]/browser:basis-0 @min-[400px]/browser:flex-1"

/** The message type of a new address of the previewed page. */
const LOCATION_MESSAGE = "smith-preview-location"
/** The message type of a command to the previewed page. */
const COMMAND_MESSAGE = "smith-preview-command"

type LocationKind = "load" | "push" | "replace" | "pop"
type PreviewLocation = { href: string; kind: LocationKind }

const LOCATION_KINDS = new Set<unknown>(["load", "push", "replace", "pop"])

/**
 * The address from a location message of the page, or undefined when the
 * message is not one. The address must be on the origin of the preview.
 * The proxy puts a script in the page that sends it
 * (server/src/services/preview-background.ts).
 */
export function pageLocation(
  data: unknown,
  origin: string
): PreviewLocation | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const { type, href, kind } = data as Record<string, unknown>
  if (type !== LOCATION_MESSAGE) return undefined
  if (typeof href !== "string" || href.length > 8192) return undefined
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  if (url.origin !== origin) return undefined
  return {
    href: url.href,
    kind: LOCATION_KINDS.has(kind) ? (kind as LocationKind) : "push",
  }
}

/**
 * The history of the iframe as Smith knows it: the addresses that the page
 * told, and the one it shows. `key` is the frame key: a new iframe starts a
 * new history.
 */
type FrameHistory = { key: string; entries: string[]; index: number }

const EMPTY_HISTORY: FrameHistory = { key: "", entries: [], index: -1 }

/**
 * The history after a location message. `pending` is the step of a Back
 * (-1) or Forward (1) that Smith asked for, or 0. A move to the address
 * next to the current one in that direction is that step. A "pop" without
 * a step (the page went back itself) is a step when it shows the address
 * next to the current one. A replace changes the current entry. Any other
 * new address removes the entries after the current one and adds it.
 */
function nextFrameHistory(
  history: FrameHistory,
  { href, kind }: PreviewLocation,
  pending: -1 | 0 | 1
): FrameHistory {
  const { entries, index } = history
  if (index < 0) return { ...history, entries: [href], index: 0 }
  if (entries[index] === href) return history
  if (kind === "replace") {
    const next = [...entries]
    next[index] = href
    return { ...history, entries: next }
  }
  const steps = pending ? [pending] : kind === "pop" ? [-1, 1] : []
  for (const step of steps)
    if (entries[index + step] === href)
      return { ...history, index: index + step }
  return {
    ...history,
    entries: [...entries.slice(0, index + 1), href],
    index: index + 1,
  }
}

/** How long a Back or Forward waits for the page to move. */
const PENDING_STEP_MS = 5000

/** The field text for a page address, as "localhost:5173/settings". */
function locationAddress(href: string, port: number) {
  const url = new URL(href)
  return formatAddress({
    port,
    path: `${url.pathname}${url.search}${url.hash}`,
  })
}

/** The iframe background before the page tells its own. */
const DEFAULT_PAGE_BACKGROUND = "#ffffff"
/** For a transparent page with a dark color scheme. */
const DARK_PAGE_BACKGROUND = "#121212"

// Numbers, units and separators, one character or word at a time, so the
// match takes linear time.
const COLOR_ARGUMENTS = String.raw`(?:[\d\s.,/%+\-e]|deg|none)+`
const PAGE_COLOR = new RegExp(
  [
    String.raw`transparent`,
    String.raw`#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})`,
    String.raw`(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(${COLOR_ARGUMENTS}\)`,
    String.raw`color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)${COLOR_ARGUMENTS}\)`,
  ]
    .map((form) => `^${form}$`)
    .join("|"),
  "i"
)

/**
 * The background for the iframe from a message of the page, or undefined
 * when the message is not one. The proxy puts a script in the page that
 * sends it (server/src/services/preview-background.ts). Only plain color
 * values: rgb, hsl, hex, the CSS color functions that browsers give as a
 * computed color, and transparent.
 */
export function pageBackground(data: unknown) {
  if (typeof data !== "object" || data === null) return undefined
  const { type, color, colorScheme } = data as Record<string, unknown>
  if (type !== "smith-preview-background") return undefined
  if (typeof color !== "string" || color.length > 120) return undefined
  const value = color.trim()
  if (!PAGE_COLOR.test(value)) return undefined
  if (typeof CSS !== "undefined" && !CSS.supports("background-color", value))
    return undefined
  if (value.toLowerCase() === "transparent")
    return colorScheme === "dark"
      ? DARK_PAGE_BACKGROUND
      : DEFAULT_PAGE_BACKGROUND
  return value
}

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

export function PreviewPanel({
  cwd,
  modeSwitch,
}: {
  cwd: string
  /** The switch between the Preview and the agent's browser. */
  modeSwitch?: React.ReactNode
}) {
  const machineId = useMachineId()
  const readOnly = useMachineReadOnly()
  const savedAddress = usePreviewAddress(machineId, cwd)
  const [address, setAddress] = React.useState(savedAddress)
  const [editingAddress, setEditingAddress] = React.useState(false)
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
  const frameKey = opened ? `${opened.src}:${reloads}` : ""
  // The background color that the page tells, for the iframe that has the
  // key. A new address or a reload starts with white again.
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const [pageColor, setPageColor] = React.useState({ key: "", color: "" })
  const background =
    pageColor.key === frameKey && pageColor.color
      ? pageColor.color
      : DEFAULT_PAGE_BACKGROUND
  // The history of the iframe that has the key. A new address or a reload
  // starts a new one.
  const [storedHistory, setFrameHistory] = React.useState(EMPTY_HISTORY)
  const frameHistory =
    storedHistory.key === frameKey ? storedHistory : EMPTY_HISTORY
  const currentHref = frameHistory.entries[frameHistory.index]
  const canGoBack = frameHistory.index > 0
  const canGoForward =
    frameHistory.index >= 0 &&
    frameHistory.index < frameHistory.entries.length - 1
  // A Back or Forward that waits for the page to move.
  const pendingStepRef = React.useRef<{
    key: string
    step: -1 | 1
    until: number
  } | null>(null)
  const frameOrigin = React.useMemo(() => {
    if (!opened) return ""
    try {
      return new URL(opened.src).origin
    } catch {
      return ""
    }
  }, [opened])
  React.useEffect(() => {
    if (!frameKey) return
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow
      if (!frame || event.source !== frame) return
      const color = pageBackground(event.data)
      if (color) {
        setPageColor({ key: frameKey, color })
        return
      }
      const location = frameOrigin
        ? pageLocation(event.data, frameOrigin)
        : undefined
      if (!location) return
      const pending = pendingStepRef.current
      pendingStepRef.current = null
      const step =
        pending && pending.key === frameKey && Date.now() < pending.until
          ? pending.step
          : 0
      setFrameHistory((current) =>
        nextFrameHistory(
          current.key === frameKey
            ? current
            : { ...EMPTY_HISTORY, key: frameKey },
          location,
          step
        )
      )
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [frameKey, frameOrigin])

  /** Ask the page to go back (-1) or forward (1) in its history. */
  const step = (direction: -1 | 1) => {
    const frame = frameRef.current?.contentWindow
    if (!frame || !frameOrigin) return
    pendingStepRef.current = {
      key: frameKey,
      step: direction,
      until: Date.now() + PENDING_STEP_MS,
    }
    frame.postMessage(
      { type: COMMAND_MESSAGE, action: direction < 0 ? "back" : "forward" },
      frameOrigin
    )
  }
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
        setOpened({ src, address: formatted, port: parsed.port })
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

  // The field shows the page's address, as the page tells it, while the
  // user does not edit it. After an error, it keeps what the user typed.
  const pageAddress =
    opened && currentHref && !error
      ? locationAddress(currentHref, opened.port)
      : undefined
  const shownAddress = editingAddress ? address : (pageAddress ?? address)
  // The page that the iframe shows now, for Reload and a new tab.
  const shownSrc = currentHref ?? opened?.src

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={BROWSER_TOOLBAR_CLASS}>
        {modeSwitch}
        <TitleTooltip title="Back">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back"
            disabled={!opened || !canGoBack || readOnly}
            onClick={() => step(-1)}
          >
            <ArrowLeftIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="Forward">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Forward"
            disabled={!opened || !canGoForward || readOnly}
            onClick={() => step(1)}
          >
            <ArrowRightIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="Reload">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Reload"
            disabled={!opened || readOnly}
            onClick={() => {
              // Load the page that the iframe shows now, in a new iframe.
              if (opened && shownSrc && shownSrc !== opened.src)
                setOpened({ ...opened, src: shownSrc })
              setReloads((count) => count + 1)
            }}
          >
            <RotateCwIcon />
          </Button>
        </TitleTooltip>
        <form
          className={BROWSER_ADDRESS_CLASS}
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
            value={shownAddress}
            onFocus={(event) => {
              setAddress(shownAddress)
              setEditingAddress(true)
              event.currentTarget.select()
            }}
            onBlur={() => setEditingAddress(false)}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur()
            }}
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
                  className="ml-auto"
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
            // A button, not a link: the tooltip does not open on a link that
            // the Button renders.
            onClick={() => {
              if (shownSrc) window.open(shownSrc, "_blank", "noopener")
            }}
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
                  ? "box-content shrink-0 overflow-hidden rounded-md border border-border shadow-sm"
                  : "flex min-h-0 flex-1 flex-col"
              }
              style={
                fixedSize
                  ? {
                      width: fixedSize.width * scale,
                      height: fixedSize.height * scale,
                      backgroundColor: background,
                    }
                  : undefined
              }
            >
              <iframe
                key={frameKey}
                ref={frameRef}
                src={opened.src}
                title={`Preview of ${opened.address}`}
                className={
                  fixedSize
                    ? "block origin-top-left border-0"
                    : "min-h-0 w-full flex-1 border-0"
                }
                style={
                  fixedSize
                    ? {
                        width: fixedSize.width,
                        height: fixedSize.height,
                        transform: scale < 1 ? `scale(${scale})` : undefined,
                        backgroundColor: background,
                      }
                    : { backgroundColor: background }
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
                HTTP. Open Smith over HTTP to use the Preview.
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
