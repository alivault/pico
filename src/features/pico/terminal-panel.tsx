import * as React from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type {
  IDisposable,
  ITheme,
  Terminal as XtermTerminal,
} from "@xterm/xterm"
import { PlusIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { readStoredTerminalTabs, rememberStoredTerminalTabs } from "@/lib/pico"
import type { TerminalCreateResponse, TerminalEvent } from "@/lib/pico/api"
import {
  appliedThemeClassColorMode,
  type ResolvedThemeMode,
} from "@/lib/pico/themes"
import { cn } from "@/lib/utils"

type TerminalCreateData = Extract<TerminalCreateResponse, { ok: true }>

type TerminalStatus =
  | { type: "idle" }
  | { type: "connecting" }
  | { type: "connected"; shell?: string }
  | { type: "exited"; exitCode: number; signal?: number }
  | { type: "error"; message: string }

type TerminalTab = {
  id: string
  status: TerminalStatus
  terminalId: string | null
}

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
  onTerminalIdChange: (tabId: string, terminalId: string) => void
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

function createTerminalTabsState(scopeKey: string): TerminalTabsState {
  const storedTabs = readStoredTerminalTabs(scopeKey)
  const tabs = storedTabs.tabs.map((id) => createTerminalTab(id))
  return {
    activeTabId: storedTabs.activeTabId ?? tabs[0]?.id ?? null,
    scopeKey,
    tabs,
  }
}

function rememberTerminalTabsState(state: TerminalTabsState) {
  rememberStoredTerminalTabs(state.scopeKey, {
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => tab.id),
  })
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
    case "error":
    case "exited":
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

function TerminalStatusDot({ status }: { status: TerminalStatus }) {
  if (status.type === "connecting") {
    return <Spinner size="xs" className="shrink-0" />
  }

  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", statusDotClassName(status))}
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
            <dd>{terminalStatusText(status)}</dd>
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

function TerminalTabPane({
  active,
  cwd,
  onStatusChange,
  onTerminalIdChange,
  selected,
  sessionId,
  tabId,
  viewerContextId,
}: TerminalTabPaneProps) {
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
    let eventSource: EventSource | null = null
    let inputDisposable: IDisposable | null = null
    let fitAddon: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let inputFlushTimer: number | null = null
    let resizeFrame: number | null = null
    let inputBuffer = ""
    let lastResizeKey = ""

    const requestOptions = sessionId
      ? { contextId: viewerContextId, sessionId }
      : { contextId: viewerContextId }

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

    const flushInput = () => {
      inputFlushTimer = null
      const id = terminalIdRef.current
      if (!id || !inputBuffer) return

      const data = inputBuffer
      inputBuffer = ""
      void postJson(`/api/terminal/${encodeURIComponent(id)}/input`, {
        data,
      }).catch((error) => {
        if (!disposed) {
          publishStatus({ type: "error", message: errorMessage(error) })
        }
      })
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

      const id = terminalIdRef.current
      if (!id) return

      const resizeKey = `${terminal.cols}x${terminal.rows}`
      if (resizeKey === lastResizeKey) return
      lastResizeKey = resizeKey

      void postJson(`/api/terminal/${encodeURIComponent(id)}/resize`, {
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch(() => {})
    }

    const scheduleFitAndResize = () => {
      if (resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        fitAndResize()
      })
    }

    fitAndResizeRef.current = scheduleFitAndResize

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
        inputDisposable = terminal.onData((data) => {
          if (!activeRef.current) return

          inputBuffer += data
          scheduleInputFlush()
        })

        scheduleFitAndResize()

        const terminalResponse = await postJson<TerminalCreateData>(
          "/api/terminal",
          {
            clientKey: tabId,
            cols: terminal.cols,
            rows: terminal.rows,
          }
        )
        if (disposed) return

        terminalIdRef.current = terminalResponse.id
        onTerminalIdChangeRef.current(tabId, terminalResponse.id)
        publishStatus({ type: "connected", shell: terminalResponse.shell })

        eventSource = new EventSource(
          buildRequestUrl(
            `/api/terminal/${encodeURIComponent(terminalResponse.id)}/events`,
            requestOptions
          )
        )
        eventSource.onmessage = (message) => {
          if (disposed) return

          const event = JSON.parse(message.data) as TerminalEvent
          if (event.type === "output") {
            terminal.write(event.data)
            return
          }

          if (event.type === "ready") {
            publishStatus({ type: "connected", shell: event.shell })
            return
          }

          if (event.type === "exit") {
            publishStatus(exitedStatus(event))
            return
          }

          if (event.type === "error") {
            publishStatus({ type: "error", message: event.error })
          }
        }
        eventSource.onerror = () => {
          if (!disposed && terminalIdRef.current) {
            setStatus((current) => {
              if (current.type === "connected") return current

              const nextStatus: TerminalStatus = {
                type: "error",
                message: "Terminal connection interrupted.",
              }
              onStatusChangeRef.current(tabId, nextStatus)
              return nextStatus
            })
          }
        }

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
      flushInput()
      resizeObserver?.disconnect()
      eventSource?.close()
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

export function TerminalPanel({
  active,
  className,
  cwd,
  onClose,
  sessionId,
  showCloseButton = true,
  viewerContextId,
}: TerminalPanelProps) {
  const normalizedCwd = cwd?.trim() || ""
  const scopeKey = `${viewerContextId}:${sessionId ?? "no-session"}:${normalizedCwd}`
  const [tabsState, setTabsState] = React.useState<TerminalTabsState>(() =>
    createTerminalTabsState(scopeKey)
  )
  const [statusDialogTabId, setStatusDialogTabId] = React.useState<
    string | null
  >(null)
  const tabs = tabsState.scopeKey === scopeKey ? tabsState.tabs : []
  const selectedTabId =
    tabsState.scopeKey === scopeKey
      ? (tabsState.activeTabId ?? tabs[0]?.id ?? null)
      : null

  React.useEffect(() => {
    if (tabsState.scopeKey === scopeKey) return

    setTabsState(createTerminalTabsState(scopeKey))
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

    const tab = createTerminalTab()
    const nextState = { activeTabId: tab.id, scopeKey, tabs: [tab] }
    rememberTerminalTabsState(nextState)
    setTabsState(nextState)
  }, [active, normalizedCwd, scopeKey, tabs.length, tabsState.scopeKey])

  const activeTab = tabs.find((tab) => tab.id === selectedTabId)
  const activeStatus = activeTab?.status ?? { type: "idle" }
  const activeError =
    activeStatus.type === "error" ? activeStatus.message : undefined
  const statusDialogTab = tabs.find((tab) => tab.id === statusDialogTabId)
  const statusDialogTabIndex = statusDialogTab
    ? tabs.indexOf(statusDialogTab)
    : 0

  const requestOptions = sessionId
    ? { contextId: viewerContextId, sessionId }
    : { contextId: viewerContextId }

  const addTerminalTab = () => {
    if (!normalizedCwd) return

    const tab = createTerminalTab()
    setTabsState((current) => {
      const nextState =
        current.scopeKey !== scopeKey
          ? { activeTabId: tab.id, scopeKey, tabs: [tab] }
          : {
              ...current,
              activeTabId: tab.id,
              tabs: [...current.tabs, tab],
            }
      rememberTerminalTabsState(nextState)
      return nextState
    })
  }

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
      rememberTerminalTabsState(nextState)
      return nextState
    })
  }

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

  const updateTabTerminalId = (tabId: string, terminalId: string) => {
    setTabsState((current) => {
      if (current.scopeKey !== scopeKey) return current

      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, terminalId } : tab
        ),
      }
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
          {tabs.map((tab, index) => {
            const selected = tab.id === selectedTabId
            const label = terminalTabLabel(tab, index)
            const statusText = terminalStatusText(tab.status)
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex h-7 max-w-48 shrink-0 items-center overflow-hidden rounded-md border text-xs",
                  selected
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <TitleTooltip title={`${label} · ${statusText}`}>
                  <button
                    type="button"
                    className="flex h-full w-7 shrink-0 items-center justify-center outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`Show ${label} status`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setStatusDialogTabId(tab.id)
                    }}
                  >
                    <TerminalStatusDot status={tab.status} />
                  </button>
                </TitleTooltip>
                <TitleTooltip title={`${label} · ${statusText}`}>
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center px-1 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => {
                      setTabsState((current) => {
                        if (current.scopeKey !== scopeKey) return current

                        const nextState = { ...current, activeTabId: tab.id }
                        rememberTerminalTabsState(nextState)
                        return nextState
                      })
                    }}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                </TitleTooltip>
                <TitleTooltip title={`Close ${label}`}>
                  <button
                    type="button"
                    className="flex h-full w-6 shrink-0 items-center justify-center text-muted-foreground opacity-70 outline-hidden group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                    aria-label={`Close ${label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTerminalTab(tab.id)
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                </TitleTooltip>
              </div>
            )
          })}

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
              <XIcon />
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
