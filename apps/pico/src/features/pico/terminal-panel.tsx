import * as React from "react"
import {
  takePendingJobTerminals,
  usePicoEvent,
} from "@/features/pico/agent/events"
import type { FitAddon } from "@xterm/addon-fit"
import type {
  IDisposable,
  ITheme,
  Terminal as XtermTerminal,
} from "@xterm/xterm"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core"
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronDownIcon,
  KeyboardIcon,
  KeyRoundIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  jobPrompt,
  useSessionJobs,
  type SessionJob,
} from "@/features/pico/agent/job-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { formatDisplayPath } from "@/features/pico/app-shell-common"
import {
  appShortcut,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { readStoredTerminalTabs, rememberStoredTerminalTabs } from "@/lib/pico"
import { machineOfflineLabel } from "@/lib/pico/machine"
import type { TerminalCreateResponse, TerminalEvent } from "@/lib/pico/api"
import {
  appliedThemeClassColorMode,
  type ResolvedThemeMode,
} from "@/lib/pico/themes"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type TerminalCreateData = Extract<TerminalCreateResponse, { ok: true }>

export type TerminalStatus =
  | { type: "idle" }
  | { type: "connecting" }
  | { type: "connected"; shell?: string }
  | { type: "exited"; exitCode: number; signal?: number }
  | { type: "error"; message: string }

type TerminalTab = {
  id: string
  /** The job's name, for a tab that shows a background job. */
  label?: string
  /** The name that the user gave to the tab. */
  name?: string
  status: TerminalStatus
  terminalId: string | null
  /** The job of a job tab, from the session's state (not stored). */
  job?: SessionJob | undefined
}

/** A successful job tab closes this long after the user saw it finish. */
const SEEN_JOB_TAB_CLOSE_MS = 5000

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
})
const TERMINAL_TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis]

/** The ID of the job that a tab shows, if it is a job tab. */
function tabJobId(tab: TerminalTab) {
  return tab.id.startsWith("job:") ? tab.id.slice(4) : undefined
}

function jobTabFinished(tab: TerminalTab) {
  return tab.job ? tab.job.status !== "running" : tab.status.type === "exited"
}

function jobTabSucceeded(tab: TerminalTab) {
  if (tab.job)
    return (
      (tab.job.status === "exited" && tab.job.exitCode === 0) ||
      tab.job.status === "stopped"
    )
  return tab.status.type === "exited" && tab.status.exitCode === 0
}

/**
 * A job tab whose job is lost or could not start, or whose record is gone
 * (pruned, or closed by the agent) and whose job ended.
 */
function jobTabGone(tab: TerminalTab) {
  if (tab.job) return tab.job.status === "lost" || tab.job.status === "failed"
  return tab.status.type === "error" || tab.status.type === "exited"
}

type TerminalInfo = { label?: string | undefined }

type TerminalTabsState = {
  activeTabId: string | null
  scopeKey: string
  tabs: Array<TerminalTab>
}

type TerminalPanelProps = {
  active: boolean
  className?: string
  cwd?: string | undefined
  onClose?: (() => void) | undefined
  sessionId?: string | undefined
  showCloseButton?: boolean | undefined
  viewerContextId: string
}

type TerminalTabPaneProps = {
  active: boolean
  cwd: string
  onStatusChange: (tabId: string, status: TerminalStatus) => void
  onTerminalIdChange: (
    tabId: string,
    terminalId: string,
    info: TerminalInfo
  ) => void
  selected: boolean
  sessionId?: string | undefined
  tabId: string
  viewerContextId: string
}

type TerminalAnsiTheme = Required<
  Pick<
    ITheme,
    | "black"
    | "red"
    | "green"
    | "yellow"
    | "blue"
    | "magenta"
    | "cyan"
    | "white"
    | "brightBlack"
    | "brightRed"
    | "brightGreen"
    | "brightYellow"
    | "brightBlue"
    | "brightMagenta"
    | "brightCyan"
    | "brightWhite"
  >
>

const TERMINAL_ANSI_THEMES = {
  dark: {
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
  light: {
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#953800",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#9a6700",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#24292f",
  },
} as const satisfies Record<ResolvedThemeMode, TerminalAnsiTheme>

let terminalTabCounter = 0

function createTerminalTabId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `terminal-tab-${crypto.randomUUID()}`
  }

  terminalTabCounter += 1
  return `terminal-tab-${Date.now()}-${terminalTabCounter}`
}

function createTerminalTab(id = createTerminalTabId()): TerminalTab {
  return {
    id,
    status: { type: "idle" },
    terminalId: null,
  }
}

function createTerminalTabsState(
  machineId: string,
  scopeKey: string
): TerminalTabsState {
  const storedTabs = readStoredTerminalTabs(machineId, scopeKey)
  const tabs = storedTabs.tabs.map((id) => {
    const tab = createTerminalTab(id)
    const name = storedTabs.names?.[id]
    return name ? { ...tab, name } : tab
  })
  return {
    activeTabId: storedTabs.activeTabId ?? tabs[0]?.id ?? null,
    scopeKey,
    tabs,
  }
}

function rememberTerminalTabsState(
  machineId: string,
  state: TerminalTabsState
) {
  rememberStoredTerminalTabs(machineId, state.scopeKey, {
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => tab.id),
    names: Object.fromEntries(
      state.tabs.flatMap((tab) => (tab.name ? [[tab.id, tab.name]] : []))
    ),
  })
}

function isJobTab(tab: TerminalTab) {
  return tab.id.startsWith("job:")
}

function jobStatusText(status: TerminalStatus) {
  switch (status.type) {
    case "idle":
    case "connecting":
      return "Connecting…"
    case "connected":
      return "Running"
    case "exited":
      return status.exitCode === 0 ? "Done" : `Failed (exit ${status.exitCode})`
    case "error":
      return "Not available"
  }
}

function tabStatusText(tab: TerminalTab) {
  if (!isJobTab(tab)) return terminalStatusText(tab.status)
  const prompt = jobPrompt(tab.job)
  if (prompt) return prompt.quiet ? "May wait for input" : "Waits for input"
  if (tab.job?.status === "stopped") return "Stopped"
  if (tab.job?.status === "lost") return "Lost"
  return jobStatusText(tab.status)
}

function terminalStatusText(status: TerminalStatus) {
  switch (status.type) {
    case "idle":
      return "Idle"
    case "connecting":
      return "Connecting…"
    case "connected":
      return status.shell ? `Running ${status.shell}` : "Connected"
    case "exited":
      return `Exited ${status.exitCode}`
    case "error":
      return "Terminal error"
  }
}

function terminalStatusDetail(status: TerminalStatus) {
  switch (status.type) {
    case "idle":
      return "This terminal has not started yet."
    case "connecting":
      return "Pico is connecting to the terminal process."
    case "connected":
      return status.shell
        ? `The terminal is connected and running ${status.shell}.`
        : "The terminal is connected."
    case "exited":
      return typeof status.signal === "number"
        ? `The terminal process exited with code ${status.exitCode} and signal ${status.signal}.`
        : `The terminal process exited with code ${status.exitCode}.`
    case "error":
      return status.message
  }
}

function terminalTabLabel(tab: TerminalTab, index: number) {
  if (tab.name) return tab.name
  if (isJobTab(tab)) return tab.label ?? tab.job?.name ?? "Job"
  if (tab.status.type === "connected" && tab.status.shell) {
    return `${index + 1}: ${tab.status.shell}`
  }
  return `Terminal ${index + 1}`
}

function statusDotClassName(status: TerminalStatus) {
  switch (status.type) {
    case "connected":
      return "bg-success"
    case "connecting":
      return "bg-warning"
    case "exited":
      return status.exitCode === 0 ? "bg-muted-foreground/50" : "bg-destructive"
    case "error":
      return "bg-destructive"
    case "idle":
      return "bg-muted-foreground/50"
  }
}

function cssVariable(name: string, fallback: string) {
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

function resolveTerminalThemeMode(): ResolvedThemeMode {
  for (const className of document.documentElement.classList) {
    const mode = appliedThemeClassColorMode(className)
    if (mode) return mode
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function terminalAnsiTheme(): TerminalAnsiTheme {
  const fallback = TERMINAL_ANSI_THEMES[resolveTerminalThemeMode()]

  return {
    black: cssVariable("--terminal-ansi-black", fallback.black),
    red: cssVariable("--terminal-ansi-red", fallback.red),
    green: cssVariable("--terminal-ansi-green", fallback.green),
    yellow: cssVariable("--terminal-ansi-yellow", fallback.yellow),
    blue: cssVariable("--terminal-ansi-blue", fallback.blue),
    magenta: cssVariable("--terminal-ansi-magenta", fallback.magenta),
    cyan: cssVariable("--terminal-ansi-cyan", fallback.cyan),
    white: cssVariable("--terminal-ansi-white", fallback.white),
    brightBlack: cssVariable(
      "--terminal-ansi-bright-black",
      fallback.brightBlack
    ),
    brightRed: cssVariable("--terminal-ansi-bright-red", fallback.brightRed),
    brightGreen: cssVariable(
      "--terminal-ansi-bright-green",
      fallback.brightGreen
    ),
    brightYellow: cssVariable(
      "--terminal-ansi-bright-yellow",
      fallback.brightYellow
    ),
    brightBlue: cssVariable("--terminal-ansi-bright-blue", fallback.brightBlue),
    brightMagenta: cssVariable(
      "--terminal-ansi-bright-magenta",
      fallback.brightMagenta
    ),
    brightCyan: cssVariable("--terminal-ansi-bright-cyan", fallback.brightCyan),
    brightWhite: cssVariable(
      "--terminal-ansi-bright-white",
      fallback.brightWhite
    ),
  }
}

function createTerminalTheme(): ITheme {
  const ansiTheme = terminalAnsiTheme()

  return {
    ...ansiTheme,
    background: cssVariable(
      "--terminal-background",
      cssVariable("--background", "#111111")
    ),
    cursor: cssVariable(
      "--terminal-cursor",
      cssVariable("--primary", "#7aa2f7")
    ),
    foreground: cssVariable(
      "--terminal-foreground",
      cssVariable("--foreground", ansiTheme.brightWhite)
    ),
    selectionBackground: cssVariable(
      "--terminal-selection-background",
      cssVariable("--code-selection", "#334155")
    ),
  }
}

function createTerminalFontFamily() {
  return cssVariable(
    "--font-mono",
    'Menlo, ui-monospace, SFMono-Regular, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  )
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "Unknown terminal error"
}

function buildTerminalWebSocketUrl(
  path: string,
  options: Parameters<typeof buildRequestUrl>[1]
) {
  const url = new URL(buildRequestUrl(path, options))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

/** An error from a server that restarts or a network that drops. */
function isTransientError(error: unknown) {
  return /^5\d\d\b|failed to fetch|networkerror|load failed|restarting|JSON/i.test(
    errorMessage(error)
  )
}

function exitedStatus(event: Extract<TerminalEvent, { type: "exit" }>) {
  return typeof event.signal === "number" && event.signal > 0
    ? {
        type: "exited" as const,
        exitCode: event.exitCode,
        signal: event.signal,
      }
    : {
        type: "exited" as const,
        exitCode: event.exitCode,
      }
}

function isTerminalToggleEvent(event: React.KeyboardEvent) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === "`" || event.code === "Backquote")
  )
}

function TerminalStatusDot({
  status,
  waiting = false,
}: {
  status: TerminalStatus
  waiting?: boolean
}) {
  if (status.type === "connecting") {
    return <Spinner size="xs" className="shrink-0" />
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        waiting ? "animate-pulse bg-sky-500" : statusDotClassName(status)
      )}
    />
  )
}

type TerminalStatusDialogProps = {
  cwd: string
  index: number
  onOpenChange: (open: boolean) => void
  open: boolean
  tab: TerminalTab | undefined
}

function TerminalStatusDialog({
  cwd,
  index,
  onOpenChange,
  open,
  tab,
}: TerminalStatusDialogProps) {
  const status = tab?.status ?? { type: "idle" as const }
  const label = tab ? terminalTabLabel(tab, index) : "Terminal"

  return (
    <Dialog open={open} onOpenChange={onOpenChange} focusPromptOnClose={false}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{label} status</DialogTitle>
          <DialogDescription>{terminalStatusDetail(status)}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm">
          <div className="grid gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              Status
            </dt>
            <dd>{tab ? tabStatusText(tab) : terminalStatusText(status)}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              Working directory
            </dt>
            <dd className="break-all">{cwd}</dd>
          </div>
        </dl>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

export function TerminalTabPane({
  active,
  cwd,
  onStatusChange,
  onTerminalIdChange,
  selected,
  sessionId,
  tabId,
  viewerContextId,
}: TerminalTabPaneProps) {
  const machineId = useMachineId()
  const terminalElementRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<XtermTerminal | null>(null)
  const terminalIdRef = React.useRef<string | null>(null)
  const activeRef = React.useRef(active)
  const fitAndResizeRef = React.useRef<() => void>(() => {})
  const onStatusChangeRef = React.useRef(onStatusChange)
  const onTerminalIdChangeRef = React.useRef(onTerminalIdChange)
  const [status, setStatus] = React.useState<TerminalStatus>({ type: "idle" })

  React.useLayoutEffect(() => {
    activeRef.current = active
  }, [active])

  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  React.useEffect(() => {
    onTerminalIdChangeRef.current = onTerminalIdChange
  }, [onTerminalIdChange])

  React.useEffect(() => {
    if (!cwd) {
      setStatus({ type: "idle" })
      onStatusChangeRef.current(tabId, { type: "idle" })
      return
    }

    const terminalElement = terminalElementRef.current
    if (!terminalElement) return

    let disposed = false
    let websocket: WebSocket | null = null
    let inputDisposable: IDisposable | null = null
    let fitAddon: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let inputFlushTimer: number | null = null
    let pingTimer: number | null = null
    let reconnectTimer: number | null = null
    let resizeFrame: number | null = null
    let inputBuffer = ""
    let lastResizeKey = ""
    let lastOutputSeq = 0
    // Replayed output can hold old terminal queries (colours, device
    // attributes). xterm.js answers them, but the program does not wait for
    // the answers, and its tty echoes them as text. Drop these answers.
    let replayUntilSeq = 0
    let replayWrites = 0
    let nextInputSeq = 1
    let reconnectAttempt = 0
    let terminalExited = false
    let terminalTransportReady = false
    const pendingInputs = new Map<number, string>()
    // Input sequence numbers are per viewer on the server, so another tab
    // or client on the same terminal never makes this one's input a duplicate.
    const viewerId = createTerminalTabId()

    const requestOptions = sessionId
      ? { machineId, contextId: viewerContextId, sessionId }
      : { machineId, contextId: viewerContextId }

    const publishStatus = (nextStatus: TerminalStatus) => {
      if (disposed) return
      setStatus(nextStatus)
      onStatusChangeRef.current(tabId, nextStatus)
    }

    const postJson = async <T,>(
      path: string,
      body: Record<string, unknown>
    ) => {
      return await fetchJson<T>(buildRequestUrl(path, requestOptions), {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    }

    const sendTerminalMessage = (message: Record<string, unknown>) => {
      if (!websocket || websocket.readyState !== WebSocket.OPEN) return false

      try {
        websocket.send(JSON.stringify(message))
        return true
      } catch (error) {
        publishStatus({ type: "error", message: errorMessage(error) })
        return false
      }
    }

    const sendPendingInputs = () => {
      if (!terminalTransportReady) return

      for (const [inputSeq, data] of [...pendingInputs.entries()].sort(
        ([left], [right]) => left - right
      )) {
        if (!sendTerminalMessage({ type: "input", data, inputSeq })) return
      }
    }

    const flushInput = () => {
      inputFlushTimer = null
      if (!terminalIdRef.current || !inputBuffer || !terminalTransportReady) {
        return
      }

      const data = inputBuffer
      const inputSeq = nextInputSeq
      nextInputSeq += 1
      inputBuffer = ""
      pendingInputs.set(inputSeq, data)
      sendPendingInputs()
    }

    const scheduleInputFlush = () => {
      if (inputFlushTimer !== null) return
      inputFlushTimer = window.setTimeout(flushInput, 12)
    }

    const fitAndResize = () => {
      const terminal = terminalRef.current
      if (!terminal || !fitAddon) return

      try {
        fitAddon.fit()
      } catch {
        return
      }

      if (!terminalIdRef.current || !terminalTransportReady) return

      const resizeKey = `${terminal.cols}x${terminal.rows}`
      if (resizeKey === lastResizeKey) return
      if (
        !sendTerminalMessage({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        })
      ) {
        return
      }
      lastResizeKey = resizeKey
    }

    const scheduleFitAndResize = () => {
      if (resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        fitAndResize()
      })
    }

    fitAndResizeRef.current = scheduleFitAndResize

    const clearPingTimer = () => {
      if (pingTimer === null) return
      window.clearInterval(pingTimer)
      pingTimer = null
    }

    const startPingTimer = () => {
      clearPingTimer()
      pingTimer = window.setInterval(() => {
        sendTerminalMessage({ type: "ping" })
      }, 20_000)
    }

    const scheduleWebSocketReconnect = () => {
      if (disposed || terminalExited || reconnectTimer !== null) return

      terminalTransportReady = false
      clearPingTimer()
      reconnectAttempt += 1
      const delay = Math.min(10_000, 500 * 2 ** (reconnectAttempt - 1))
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        const id = terminalIdRef.current
        if (!id || disposed || terminalExited) return
        publishStatus({ type: "connecting" })
        connectTerminalWebSocket(id)
      }, delay)
    }

    const handleTerminalEvent = (event: TerminalEvent) => {
      const terminal = terminalRef.current
      if (!terminal) return

      if (event.type === "output") {
        if (typeof event.seq === "number") {
          if (event.seq <= lastOutputSeq) return
          lastOutputSeq = event.seq
          if (event.seq <= replayUntilSeq) {
            replayWrites += 1
            terminal.write(event.data, () => {
              replayWrites -= 1
            })
            return
          }
        }
        terminal.write(event.data)
        return
      }

      if (event.type === "reset") {
        lastOutputSeq = Math.max(0, event.firstSeq - 1)
        terminal.clear()
        terminal.writeln("Terminal output replay gap; showing retained output.")
        return
      }

      if (event.type === "ready") {
        terminalTransportReady = true
        reconnectAttempt = 0
        nextInputSeq = Math.max(nextInputSeq, event.nextInputSeq ?? 1)
        replayUntilSeq = event.replayUntilSeq ?? 0
        publishStatus({ type: "connected", shell: event.shell })
        startPingTimer()
        sendPendingInputs()
        flushInput()
        lastResizeKey = ""
        scheduleFitAndResize()
        return
      }

      if (event.type === "input_ack") {
        pendingInputs.delete(event.inputSeq)
        return
      }

      if (event.type === "pong") {
        return
      }

      if (event.type === "exit") {
        terminalExited = true
        terminalTransportReady = false
        clearPingTimer()
        publishStatus(exitedStatus(event))
        return
      }

      if (event.type === "error") {
        publishStatus({ type: "error", message: event.error })
      }
    }

    function connectTerminalWebSocket(id: string) {
      if (websocket) {
        websocket.onclose = null
        websocket.onerror = null
        websocket.onmessage = null
        websocket.close()
      }

      terminalTransportReady = false
      const nextWebSocket = new WebSocket(
        buildTerminalWebSocketUrl(
          `/api/terminal/${encodeURIComponent(id)}/ws`,
          {
            ...requestOptions,
            searchParams: {
              lastSeq: lastOutputSeq || undefined,
              viewer: viewerId,
            },
          }
        )
      )
      websocket = nextWebSocket

      nextWebSocket.onmessage = (message) => {
        if (disposed || websocket !== nextWebSocket) return

        try {
          const event = JSON.parse(message.data as string) as TerminalEvent
          handleTerminalEvent(event)
        } catch (error) {
          publishStatus({ type: "error", message: errorMessage(error) })
        }
      }
      nextWebSocket.onclose = () => {
        if (websocket !== nextWebSocket) return
        websocket = null
        terminalTransportReady = false
        scheduleWebSocketReconnect()
      }
      nextWebSocket.onerror = () => {
        if (websocket !== nextWebSocket) return
        terminalTransportReady = false
        nextWebSocket.close()
      }
    }

    const startTerminal = async () => {
      try {
        publishStatus({ type: "connecting" })
        terminalElement.textContent = ""

        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ])
        if (disposed) return

        const terminal = new Terminal({
          allowTransparency: true,
          convertEol: false,
          cursorBlink: true,
          fontFamily: createTerminalFontFamily(),
          fontSize: 12,
          letterSpacing: 0,
          lineHeight: 1.2,
          scrollback: 5000,
          theme: createTerminalTheme(),
        })
        fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(terminalElement)
        terminalRef.current = terminal
        // Let the terminal toggle shortcut through to the app, so it also
        // closes the panel while the terminal has focus.
        terminal.attachCustomKeyEventHandler(
          (event) => !matchesShortcutEvent(event, appShortcut("J"))
        )
        // The terminal takes the size of the viewer that the user works in.
        terminal.textarea?.addEventListener("focus", () => {
          sendTerminalMessage({ type: "focus" })
        })
        inputDisposable = terminal.onData((data) => {
          if (!activeRef.current) return
          // An answer to a query in replayed output.
          if (replayWrites > 0 && data.startsWith("\x1b")) return
          // An offline machine is read-only: drop typing until it is back.
          if (machineOfflineLabel(machineId) !== undefined) return

          inputBuffer += data
          scheduleInputFlush()
        })

        scheduleFitAndResize()

        // While the server restarts, the request fails for a moment: try
        // again (the pty-host keeps the terminal).
        let terminalResponse: TerminalCreateData | undefined
        for (let attempt = 0; ; attempt += 1) {
          try {
            terminalResponse = await postJson<TerminalCreateData>(
              "/api/terminal",
              {
                clientKey: tabId,
                cols: terminal.cols,
                rows: terminal.rows,
              }
            )
            break
          } catch (error) {
            if (disposed) return
            if (attempt >= 6 || !isTransientError(error)) throw error
            await new Promise((resolve) =>
              window.setTimeout(resolve, Math.min(5000, 500 * 2 ** attempt))
            )
            if (disposed) return
          }
        }
        if (disposed) return

        terminalIdRef.current = terminalResponse.id
        onTerminalIdChangeRef.current(tabId, terminalResponse.id, {
          label: terminalResponse.label,
        })
        connectTerminalWebSocket(terminalResponse.id)

        resizeObserver = new ResizeObserver(scheduleFitAndResize)
        resizeObserver.observe(terminalElement)
        scheduleFitAndResize()
      } catch (error) {
        if (disposed) return

        const message = errorMessage(error)
        publishStatus({ type: "error", message })
        terminalRef.current?.writeln(`\r\n${message}`)
      }
    }

    void startTerminal()

    return () => {
      disposed = true
      if (inputFlushTimer !== null) {
        window.clearTimeout(inputFlushTimer)
      }
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      clearPingTimer()
      flushInput()
      resizeObserver?.disconnect()
      if (websocket) {
        websocket.onclose = null
        websocket.onerror = null
        websocket.onmessage = null
        websocket.close()
      }
      inputDisposable?.dispose()
      terminalRef.current?.dispose()
      terminalRef.current = null
      terminalIdRef.current = null
      fitAndResizeRef.current = () => {}
    }
  }, [cwd, sessionId, tabId, viewerContextId])

  React.useEffect(() => {
    const applyTheme = () => {
      const terminal = terminalRef.current
      if (!terminal) return

      terminal.options.theme = createTerminalTheme()
      terminal.options.fontFamily = createTerminalFontFamily()
    }
    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "data-pico-theme-mode"],
      attributes: true,
    })
    applyTheme()
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!active) {
      terminalRef.current?.blur()
      return
    }

    const frame = window.requestAnimationFrame(() => {
      fitAndResizeRef.current()
      terminalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, status])

  return (
    <div
      aria-hidden={!selected}
      data-terminal-tab={tabId}
      className={cn(
        "absolute inset-0 min-h-0 w-full overflow-hidden bg-background",
        selected ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
      )}
    >
      <div ref={terminalElementRef} className="h-full min-h-0 w-full" />
    </div>
  )
}

type TerminalTabButtonProps = {
  index: number
  onClose: () => void
  onRename: (name: string) => void
  onSelect: () => void
  onShowStatus: () => void
  selected: boolean
  tab: TerminalTab
}

function TerminalTabButton({
  index,
  onClose,
  onRename,
  onSelect,
  onShowStatus,
  selected,
  tab,
}: TerminalTabButtonProps) {
  const [renaming, setRenaming] = React.useState(false)
  // Escape ends the rename without the blur saving the text.
  const renameCancelledRef = React.useRef(false)
  const startRename = () => {
    renameCancelledRef.current = false
    setRenaming(true)
  }
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: renaming })
  const label = terminalTabLabel(tab, index)
  const statusText = tabStatusText(tab)
  const jobEnded = isJobTab(tab) && tab.status.type === "exited"

  const tabElement = (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group flex h-7 max-w-48 shrink-0 items-center overflow-hidden rounded-md border text-xs",
        selected
          ? "border-border bg-muted text-foreground"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        isDragging && "relative z-10 opacity-70"
      )}
      {...attributes}
      {...listeners}
      // The tab holds its own buttons: it is not one button itself.
      role="presentation"
      tabIndex={-1}
    >
      <TitleTooltip title={`${label} · ${statusText}`}>
        <button
          type="button"
          className="flex h-full w-7 shrink-0 items-center justify-center outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Show ${label} status`}
          onClick={(event) => {
            event.stopPropagation()
            onShowStatus()
          }}
        >
          <TerminalStatusDot
            status={tab.status}
            waiting={jobPrompt(tab.job)?.quiet === false}
          />
        </button>
      </TitleTooltip>
      {renaming ? (
        <input
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label="Tab name"
          defaultValue={tab.name ?? label}
          className="h-full min-w-0 flex-1 bg-transparent px-1 outline-hidden"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            setRenaming(false)
            if (!renameCancelledRef.current) onRename(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === "Escape") {
              event.preventDefault()
              renameCancelledRef.current = true
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <TitleTooltip title={`${label} · ${statusText}`}>
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center px-1 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onSelect}
            onDoubleClick={startRename}
          >
            <span className="truncate">{label}</span>
            {jobEnded ? (
              <span className="ml-1 shrink-0 text-muted-foreground">
                {statusText}
              </span>
            ) : null}
          </button>
        </TitleTooltip>
      )}
      <TitleTooltip title={`Close ${label}`}>
        <button
          type="button"
          className="flex h-full w-6 shrink-0 items-center justify-center text-muted-foreground opacity-70 outline-hidden group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
          aria-label={`Close ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <XIcon className="size-3" />
        </button>
      </TitleTooltip>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={tabElement} />
      {/* The rename input takes the focus: the menu does not give it back. */}
      <ContextMenuContent className="w-40" finalFocus={false}>
        <ContextMenuItem onClick={startRename}>Rename</ContextMenuItem>
        {tab.name ? (
          <ContextMenuItem onClick={() => onRename("")}>
            Reset name
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onClose}>
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function TerminalPanel({
  active,
  className,
  cwd,
  onClose,
  sessionId,
  showCloseButton = true,
  viewerContextId,
}: TerminalPanelProps) {
  const machineId = useMachineId()
  const normalizedCwd = cwd?.trim() || ""
  const scopeKey = `${viewerContextId}:${sessionId ?? "no-session"}:${normalizedCwd}`
  const [tabsState, setTabsState] = React.useState<TerminalTabsState>(() =>
    createTerminalTabsState(machineId, scopeKey)
  )
  const [statusDialogTabId, setStatusDialogTabId] = React.useState<
    string | null
  >(null)
  const sessionJobs = useSessionJobs(viewerContextId, sessionId)
  const jobsById = new Map(sessionJobs.jobs.map((job) => [job.id, job]))
  const tabs = (tabsState.scopeKey === scopeKey ? tabsState.tabs : []).map(
    (tab) => {
      const jobId = tabJobId(tab)
      return jobId ? { ...tab, job: jobsById.get(jobId) } : tab
    }
  )
  const selectedTabId =
    tabsState.scopeKey === scopeKey
      ? (tabsState.activeTabId ?? tabs[0]?.id ?? null)
      : null

  React.useEffect(() => {
    if (tabsState.scopeKey === scopeKey) return

    setTabsState((current) =>
      current.scopeKey === scopeKey
        ? current
        : createTerminalTabsState(machineId, scopeKey)
    )
  }, [scopeKey, tabsState.scopeKey])

  React.useEffect(() => {
    if (
      !active ||
      !normalizedCwd ||
      tabs.length > 0 ||
      tabsState.scopeKey !== scopeKey
    ) {
      return
    }

    // An update in the same batch (for example a job tab) may add a tab first.
    setTabsState((current) => {
      if (current.scopeKey === scopeKey && current.tabs.length > 0)
        return current
      const tab = createTerminalTab()
      const nextState = { activeTabId: tab.id, scopeKey, tabs: [tab] }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }, [active, normalizedCwd, scopeKey, tabs.length, tabsState.scopeKey])

  const activeTab = tabs.find((tab) => tab.id === selectedTabId)
  const activeJobPrompt = activeTab ? jobPrompt(activeTab.job) : undefined
  // A guessed wait shows only in the tab's status, not in a prompt bar.
  const activePrompt = activeJobPrompt?.quiet ? undefined : activeJobPrompt
  const activeStatus = activeTab?.status ?? { type: "idle" }
  const activeError =
    activeStatus.type === "error" ? activeStatus.message : undefined
  const statusDialogTab = tabs.find((tab) => tab.id === statusDialogTabId)
  const statusDialogTabIndex = statusDialogTab
    ? tabs.indexOf(statusDialogTab)
    : 0

  const requestOptions = sessionId
    ? { machineId, contextId: viewerContextId, sessionId }
    : { machineId, contextId: viewerContextId }

  const addTerminalTab = () => {
    if (!normalizedCwd) return

    const tab = createTerminalTab()
    setTabsState((current) => {
      const base =
        current.scopeKey === scopeKey
          ? current
          : createTerminalTabsState(machineId, scopeKey)
      const nextState = {
        ...base,
        activeTabId: tab.id,
        tabs: [...base.tabs, tab],
      }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  const showJobTab = (jobId: string) => {
    const tabId = `job:${jobId}`
    setTabsState((current) => {
      // A state of another scope is not loaded yet: start from the stored
      // tabs of this scope, not from none.
      const base =
        current.scopeKey === scopeKey
          ? current
          : createTerminalTabsState(machineId, scopeKey)
      const nextState = base.tabs.some((tab) => tab.id === tabId)
        ? { ...base, activeTabId: tabId }
        : {
            ...base,
            activeTabId: tabId,
            tabs: [...base.tabs, createTerminalTab(tabId)],
          }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  usePicoEvent("pico:open-job-terminal", () => {
    for (const jobId of takePendingJobTerminals()) showJobTab(jobId)
  })
  React.useEffect(() => {
    for (const jobId of takePendingJobTerminals()) showJobTab(jobId)
    // Read the queue once the panel shows a scope.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  // A focus request (the terminal tool's focus action) shows its job's tab while it is open, also
  // when the panel mounts after the request.
  const shownFocus = React.useRef(new Set<string>())
  const focusKey = sessionJobs.jobs
    .filter((job) => job.status === "running" && job.focus && !job.focus.inline)
    .map((job) => `${job.id}@${job.focus?.at}`)
    .join(" ")
  const showFocusedJobs = React.useEffectEvent((keys: Array<string>) => {
    for (const key of keys) {
      if (shownFocus.current.has(`${scopeKey}:${key}`)) continue
      shownFocus.current.add(`${scopeKey}:${key}`)
      showJobTab(key.slice(0, key.indexOf("@")))
    }
  })
  React.useEffect(() => {
    showFocusedJobs(focusKey.split(" ").filter(Boolean))
  }, [focusKey, scopeKey])

  const closeServerTerminal = (terminalId: string | null) => {
    if (!terminalId) return

    void fetchJson(
      buildRequestUrl(
        `/api/terminal/${encodeURIComponent(terminalId)}/close`,
        requestOptions
      ),
      { method: "POST" }
    ).catch(() => {})
  }

  const closeTerminalTab = (tabId: string) => {
    if (tabs.length <= 0) return

    const closingTab = tabs.find((tab) => tab.id === tabId)
    closeServerTerminal(closingTab?.terminalId ?? null)

    setTabsState((current) => {
      if (current.scopeKey !== scopeKey || current.tabs.length <= 0) {
        return current
      }

      const closingIndex = current.tabs.findIndex((tab) => tab.id === tabId)
      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId)
      const nextActiveTabId =
        current.activeTabId === tabId
          ? (nextTabs[Math.min(Math.max(closingIndex, 0), nextTabs.length - 1)]
              ?.id ?? null)
          : current.activeTabId

      const nextState = {
        ...current,
        activeTabId: nextActiveTabId,
        tabs: nextTabs,
      }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  // Job tabs close themselves: a gone job at once, a successful job some
  // seconds after the user saw it finish. Failed and unseen jobs stay.
  const [seenJobTabs, setSeenJobTabs] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const activeJobTabFinished =
    activeTab !== undefined && isJobTab(activeTab) && jobTabFinished(activeTab)
  React.useEffect(() => {
    if (!active || !activeJobTabFinished || !selectedTabId) return
    setSeenJobTabs((current) =>
      current.has(selectedTabId)
        ? current
        : new Set([...current, selectedTabId])
    )
  }, [active, activeJobTabFinished, selectedTabId])
  const closeJobTab = React.useEffectEvent((tabId: string) => {
    // The last tab goes with the panel: no new shell opens in its place.
    if (tabs.length === 1 && tabs[0]?.id === tabId) onClose?.()
    closeTerminalTab(tabId)
  })
  const goneJobTabs = sessionJobs.loaded
    ? tabs
        .filter((tab) => isJobTab(tab) && jobTabGone(tab))
        .map((tab) => tab.id)
    : []
  const doneJobTabs = tabs
    .filter(
      (tab) => isJobTab(tab) && seenJobTabs.has(tab.id) && jobTabSucceeded(tab)
    )
    .map((tab) => tab.id)
  const goneKey = goneJobTabs.join(" ")
  const doneKey = doneJobTabs.join(" ")
  React.useEffect(() => {
    for (const tabId of goneKey.split(" ").filter(Boolean)) closeJobTab(tabId)
  }, [goneKey])
  React.useEffect(() => {
    const ids = doneKey.split(" ").filter(Boolean)
    if (ids.length === 0) return
    const timer = window.setTimeout(() => {
      for (const tabId of ids) closeJobTab(tabId)
    }, SEEN_JOB_TAB_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [doneKey])

  const updateTabStatus = (tabId: string, status: TerminalStatus) => {
    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, status } : tab
        ),
      }
    })
  }

  const updateTabTerminalId = (
    tabId: string,
    terminalId: string,
    info: TerminalInfo
  ) => {
    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                terminalId,
                ...(info.label ? { label: info.label } : {}),
              }
            : tab
        ),
      }
    })
  }

  const selectTab = (tabId: string) => {
    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      const nextState = { ...current, activeTabId: tabId }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  const renameTab = (tabId: string, name: string) => {
    const text = name.trim().slice(0, 100)
    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      const nextState = {
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== tabId) return tab
          const { name: _name, ...rest } = tab
          return text ? { ...rest, name: text } : rest
        }),
      }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleTabDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return

    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      const from = current.tabs.findIndex((tab) => tab.id === dragged.id)
      const to = current.tabs.findIndex((tab) => tab.id === over.id)
      if (from < 0 || to < 0) return current

      const nextState = {
        ...current,
        tabs: arrayMove(current.tabs, from, to),
      }
      rememberTerminalTabsState(machineId, nextState)
      return nextState
    })
  }

  return (
    <section
      data-terminal-panel="true"
      className={cn(
        "pico-terminal-panel flex h-full min-h-0 w-full min-w-0 flex-col bg-background",
        className
      )}
      onKeyDownCapture={(event) => {
        if (!isTerminalToggleEvent(event) || !onClose) return

        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        onClose()
      }}
    >
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border/70 px-2">
        <div className="hidden max-w-56 min-w-0 flex-col gap-0 px-1 sm:flex">
          <div className="truncate text-xs font-medium">Terminal</div>
          <div className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
            <TerminalStatusDot status={activeStatus} />
            <span className="truncate">
              {normalizedCwd ? formatDisplayPath(normalizedCwd) : "No cwd"}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          <DndContext
            sensors={tabSensors}
            collisionDetection={closestCenter}
            modifiers={TERMINAL_TAB_DRAG_MODIFIERS}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab, index) => (
                <TerminalTabButton
                  key={tab.id}
                  index={index}
                  selected={tab.id === selectedTabId}
                  tab={tab}
                  onClose={() => closeTerminalTab(tab.id)}
                  onRename={(name) => renameTab(tab.id, name)}
                  onSelect={() => selectTab(tab.id)}
                  onShowStatus={() => setStatusDialogTabId(tab.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {normalizedCwd ? (
            <TitleTooltip title="New terminal tab">
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label="New terminal tab"
                onClick={addTerminalTab}
              >
                <PlusIcon className="size-4" />
              </Button>
            </TitleTooltip>
          ) : null}
        </div>

        {activeError ? (
          <TitleTooltip title={activeError}>
            <span className="hidden max-w-48 truncate text-[11px] text-destructive sm:inline">
              {activeError}
            </span>
          </TitleTooltip>
        ) : null}
        {onClose && showCloseButton ? (
          <TitleTooltip title="Hide terminal">
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label="Hide terminal"
              onClick={onClose}
            >
              <ChevronDownIcon />
            </Button>
          </TitleTooltip>
        ) : null}
      </div>
      <TerminalStatusDialog
        cwd={normalizedCwd}
        index={statusDialogTabIndex}
        open={statusDialogTab !== undefined}
        tab={statusDialogTab}
        onOpenChange={(open) => {
          if (!open) setStatusDialogTabId(null)
        }}
      />
      {normalizedCwd && activePrompt ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-sky-500/10 px-3 py-1.5 text-xs"
        >
          {activePrompt.secret ? (
            <KeyRoundIcon className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          ) : (
            <KeyboardIcon className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          )}
          <span className="min-w-0 truncate">{activePrompt.text}</span>
          {activePrompt.secret ? (
            <span className="ml-auto shrink-0 text-muted-foreground">
              What you type is not shown
            </span>
          ) : null}
        </div>
      ) : null}
      {normalizedCwd ? (
        tabs.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            {tabs.map((tab) => {
              const selected = tab.id === selectedTabId
              return (
                <TerminalTabPane
                  key={tab.id}
                  active={active && selected}
                  cwd={normalizedCwd}
                  onStatusChange={updateTabStatus}
                  onTerminalIdChange={updateTabTerminalId}
                  selected={selected}
                  sessionId={sessionId}
                  tabId={tab.id}
                  viewerContextId={viewerContextId}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
            <div>No terminal tabs are open.</div>
            <Button size="sm" variant="outline" onClick={addTerminalTab}>
              <PlusIcon className="size-4" />
              New terminal tab
            </Button>
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Open a session before starting a terminal.
        </div>
      )}
    </section>
  )
}
