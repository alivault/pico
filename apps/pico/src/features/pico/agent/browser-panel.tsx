/**
 * The Browser tab of the right sidebar: a live view of the agent's browser
 * (server/src/services/browser-view.ts). It shows the active tab as frames
 * and sends what the user does in it: clicks, the wheel, keys, and text.
 * The agent and the user use the same tabs and cookies, so the user can log
 * in for the agent. When the agent asks for the user (a handoff), a banner
 * shows what to do, and its buttons answer the agent.
 */
import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  GlobeIcon,
  KeyboardIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { postAgentJson } from "@/features/pico/agent/agent-extensions"
import { buildRequestUrl } from "@/features/pico/app-shell-utils"
import { useMachineReadOnly } from "@/features/pico/machine-store"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMachineId } from "@/lib/pico/machine-context"
import { toast } from "@/lib/pico/toast"
import { cn } from "@/lib/utils"

type BrowserTab = { id: string; url: string; title: string }

type BrowserHandoff = { questionId: string; reason: string }

type ViewState = {
  open: boolean
  tabs: Array<BrowserTab>
  active?: string
  handoff?: BrowserHandoff
  fileChooser?: { multiple: boolean }
}

type ViewEvent =
  | ({ type: "state" } & ViewState)
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "error"; error: string }

type Frame = { src: string; width: number; height: number }

const RECONNECT_DELAY_MS = 1500

/** The pixels of a wheel line, for a wheel event in lines. */
const WHEEL_LINE_PX = 16

/** Keys that the view sends by name; other keys come as text. */
const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
])

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"])

/**
 * The key of a keydown as Playwright names it, with its modifiers, or
 * undefined when the key comes as text (a printable key without Control or
 * Command). Command is Control in the agent's Chrome, which runs on the
 * server.
 */
function playwrightKey(event: React.KeyboardEvent) {
  if (MODIFIER_KEYS.has(event.key)) return undefined
  const command = event.ctrlKey || event.metaKey
  if (!NAMED_KEYS.has(event.key) && (!command || event.key.length !== 1))
    return undefined
  const modifiers = [
    command ? "ControlOrMeta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean)
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  return [...modifiers, key].join("+")
}

/** Files as the server takes them: name, type, and base64 data. */
async function encodeFiles(files: Iterable<File>) {
  return Promise.all(
    [...files].map(
      (file) =>
        new Promise<{ name: string; mimeType: string; data: string }>(
          (resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const url = typeof reader.result === "string" ? reader.result : ""
              resolve({
                name: file.name,
                mimeType: file.type,
                data: url.slice(url.indexOf(",") + 1),
              })
            }
            reader.onerror = () => reject(reader.error ?? new Error("Read"))
            reader.readAsDataURL(file)
          }
        )
    )
  )
}

function useBrowserSocket({
  agentId,
  viewerContextId,
  active,
}: {
  agentId: string | undefined
  viewerContextId: string
  active: boolean
}) {
  const machineId = useMachineId()
  const [state, setState] = React.useState<ViewState | null>(null)
  const [frame, setFrame] = React.useState<Frame | null>(null)
  const [error, setError] = React.useState("")
  const socketRef = React.useRef<WebSocket | null>(null)

  React.useEffect(() => {
    if (!active || !agentId || !viewerContextId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const url = new URL(
        buildRequestUrl("/api/browser/ws", {
          machineId,
          contextId: viewerContextId,
          agentId,
        }),
        window.location.href
      )
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(url)
      socketRef.current = socket
      socket.onmessage = (message) => {
        let event: ViewEvent
        try {
          event = JSON.parse(String(message.data)) as ViewEvent
        } catch {
          return
        }
        if (event.type === "state") {
          setState({
            open: event.open,
            tabs: event.tabs,
            ...(event.active ? { active: event.active } : {}),
            ...(event.handoff ? { handoff: event.handoff } : {}),
            ...(event.fileChooser ? { fileChooser: event.fileChooser } : {}),
          })
          setError("")
          if (!event.open) setFrame(null)
        } else if (event.type === "frame") {
          setFrame({
            src: `data:image/jpeg;base64,${event.data}`,
            width: event.width,
            height: event.height,
          })
        } else setError(event.error)
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        timer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }
    connect()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [active, agentId, machineId, viewerContextId])

  // Another agent: the view starts empty.
  React.useEffect(() => {
    setState(null)
    setFrame(null)
    setError("")
  }, [agentId])

  const send = (message: Record<string, unknown>) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message))
  }

  return { state, frame, error, send }
}

/** Answer the agent's handoff question. */
function useAnswerHandoff(viewerContextId: string, agentId?: string) {
  const machineId = useMachineId()
  const [sending, setSending] = React.useState(false)
  const answer = (questionId: string, value: string) => {
    setSending(true)
    void postAgentJson(
      machineId,
      viewerContextId,
      agentId,
      "/api/agent/answer",
      { questionId, value }
    )
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setSending(false))
  }
  return { sending, answer }
}

export function BrowserPanel({
  agentId,
  viewerContextId,
  active,
}: {
  agentId: string | undefined
  viewerContextId: string
  active: boolean
}) {
  const { state, frame, error, send } = useBrowserSocket({
    agentId,
    viewerContextId,
    active,
  })
  const readOnly = useMachineReadOnly()
  const isMobile = useIsMobile()
  const handoff = useAnswerHandoff(viewerContextId, agentId)
  const activeTab = state?.tabs.find((tab) => tab.id === state.active)
  const [address, setAddress] = React.useState("")
  const [editingAddress, setEditingAddress] = React.useState(false)
  const shownAddress = editingAddress ? address : (activeTab?.url ?? "")
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const keysRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = React.useState(false)

  /** Send files: for the open file dialog, or as a drop at a point. */
  const sendFiles = (
    files: FileList | null,
    point?: { x: number; y: number }
  ) => {
    if (!files || files.length === 0) return
    void encodeFiles(files)
      .then((encoded) => send({ type: "files", files: encoded, ...point }))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  }
  const pendingMoveRef = React.useRef<{ x: number; y: number } | null>(null)
  const moveFrameRef = React.useRef(0)
  const touchRef = React.useRef<{
    x: number
    y: number
    lastX: number
    lastY: number
    scrolled: boolean
  } | null>(null)

  const navigate = (url: string) => {
    send({ type: "navigate", url })
    setEditingAddress(false)
  }

  /** The page point under a pointer, in the page's CSS pixels. */
  const pagePoint = (clientX: number, clientY: number) => {
    const image = imageRef.current
    if (!image || !frame) return undefined
    const rect = image.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return undefined
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * frame.width),
      y: Math.round(((clientY - rect.top) / rect.height) * frame.height),
    }
  }

  const sendMove = (point: { x: number; y: number }) => {
    // At most one move for each animation frame.
    pendingMoveRef.current = point
    if (moveFrameRef.current) return
    moveFrameRef.current = window.requestAnimationFrame(() => {
      moveFrameRef.current = 0
      const pending = pendingMoveRef.current
      pendingMoveRef.current = null
      if (pending) send({ type: "mouse", action: "move", ...pending })
    })
  }

  const button = (event: React.PointerEvent) =>
    event.button === 2 ? "right" : event.button === 1 ? "middle" : "left"

  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (readOnly) return
    const point = pagePoint(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    if (!isMobile) keysRef.current?.focus({ preventScroll: true })
    if (event.pointerType === "touch") {
      // A touch is a click, or a scroll when it moves.
      touchRef.current = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        scrolled: false,
      }
      return
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that is gone already.
    }
    send({
      type: "mouse",
      action: "down",
      ...point,
      button: button(event),
      clickCount: Math.max(1, event.detail),
    })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (readOnly) return
    const touch = touchRef.current
    if (event.pointerType === "touch" && touch) {
      const moved = Math.hypot(event.clientX - touch.x, event.clientY - touch.y)
      if (!touch.scrolled && moved < 8) return
      touch.scrolled = true
      const point = pagePoint(event.clientX, event.clientY)
      const rect = imageRef.current?.getBoundingClientRect()
      if (!point || !rect || !frame) return
      const scale = frame.width / rect.width
      send({
        type: "wheel",
        ...point,
        dx: (touch.lastX - event.clientX) * scale,
        dy: (touch.lastY - event.clientY) * scale,
      })
      touch.lastX = event.clientX
      touch.lastY = event.clientY
      return
    }
    const point = pagePoint(event.clientX, event.clientY)
    if (point) sendMove(point)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (readOnly) return
    const point = pagePoint(event.clientX, event.clientY)
    if (!point) return
    if (event.pointerType === "touch") {
      const touch = touchRef.current
      touchRef.current = null
      if (!touch || touch.scrolled) return
      send({ type: "mouse", action: "down", ...point })
      send({ type: "mouse", action: "up", ...point })
      return
    }
    send({
      type: "mouse",
      action: "up",
      ...point,
      button: button(event),
      clickCount: Math.max(1, event.detail),
    })
  }

  const onWheel = (event: React.WheelEvent<HTMLImageElement>) => {
    if (readOnly) return
    const point = pagePoint(event.clientX, event.clientY)
    if (!point) return
    const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : 1
    send({
      type: "wheel",
      ...point,
      dx: event.deltaX * scale,
      dy: event.deltaY * scale,
    })
  }

  // Keys go to a hidden text field, so that phones show their keyboard and
  // input methods work. Text comes from `beforeinput`; named keys and keys
  // with Control or Command from `keydown`.
  React.useEffect(() => {
    const field = keysRef.current
    if (!field) return
    const onBeforeInput = (event: InputEvent) => {
      event.preventDefault()
      if (event.inputType === "insertText" && event.data)
        send({ type: "text", text: event.data })
      else if (event.inputType === "insertFromPaste" && event.data)
        send({ type: "text", text: event.data })
      else if (event.inputType === "deleteContentBackward")
        send({ type: "key", key: "Backspace" })
      else if (event.inputType === "deleteContentForward")
        send({ type: "key", key: "Delete" })
      else if (
        event.inputType === "insertLineBreak" ||
        event.inputType === "insertParagraph"
      )
        send({ type: "key", key: "Enter" })
    }
    const onCompositionEnd = (event: CompositionEvent) => {
      if (event.data) send({ type: "text", text: event.data })
      field.value = ""
    }
    field.addEventListener("beforeinput", onBeforeInput)
    field.addEventListener("compositionend", onCompositionEnd)
    return () => {
      field.removeEventListener("beforeinput", onBeforeInput)
      field.removeEventListener("compositionend", onCompositionEnd)
    }
  }, [send])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    // Paste comes as text in `onPaste`: the agent's Chrome cannot read
    // this computer's clipboard.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v")
      return
    const key = playwrightKey(event)
    if (!key) return
    event.preventDefault()
    send({ type: "key", key })
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData("text/plain")
    if (text) send({ type: "text", text })
  }

  if (!agentId)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select an agent to see its browser.
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {state?.handoff ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-primary">
              The agent needs you:{" "}
            </span>
            {state.handoff.reason}
          </span>
          <span className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              disabled={handoff.sending || readOnly}
              onClick={() => handoff.answer(state.handoff!.questionId, "Done")}
            >
              Done
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={handoff.sending || readOnly}
              onClick={() =>
                handoff.answer(state.handoff!.questionId, "I can't do it")
              }
            >
              I can't
            </Button>
          </span>
        </div>
      ) : null}
      {state?.fileChooser ? (
        // Chrome runs without a window, so its file dialog does not show.
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            The page asks for {state.fileChooser.multiple ? "files" : "a file"}.
          </span>
          <span className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              disabled={readOnly}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose {state.fileChooser.multiple ? "files" : "a file"}…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              onClick={() => send({ type: "cancel_files" })}
            >
              Cancel
            </Button>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple={state.fileChooser.multiple}
            onChange={(event) => {
              sendFiles(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
          />
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 p-1.5">
        <TitleTooltip title="Back">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back"
            disabled={!activeTab || readOnly}
            onClick={() => send({ type: "back" })}
          >
            <ArrowLeftIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="Forward">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Forward"
            disabled={!activeTab || readOnly}
            onClick={() => send({ type: "forward" })}
          >
            <ArrowRightIcon />
          </Button>
        </TitleTooltip>
        <TitleTooltip title="Reload">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Reload"
            disabled={!activeTab || readOnly}
            onClick={() => send({ type: "reload" })}
          >
            <RotateCwIcon />
          </Button>
        </TitleTooltip>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(address)
            // The field shows the tab's address again.
            const field = event.currentTarget.elements.namedItem("address")
            if (field instanceof HTMLInputElement) field.blur()
          }}
        >
          <Input
            aria-label="Address"
            name="address"
            placeholder="Go to an address"
            className="h-7 text-xs"
            disabled={readOnly}
            value={shownAddress}
            onFocus={(event) => {
              setAddress(activeTab?.url ?? "")
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
        {isMobile && state?.open ? (
          <TitleTooltip title="Keyboard">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Show the keyboard"
              disabled={readOnly}
              onClick={() => keysRef.current?.focus()}
            >
              <KeyboardIcon />
            </Button>
          </TitleTooltip>
        ) : null}
        {state && state.tabs.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="ghost" className="gap-1 px-1.5" />
              }
            >
              {state.tabs.length} tabs
              <ChevronDownIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {state.tabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  className={cn(tab.id === state.active && "font-medium")}
                  onClick={() => send({ type: "switch_tab", id: tab.id })}
                >
                  <GlobeIcon className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {tab.title || tab.url}
                  </span>
                  <button
                    type="button"
                    aria-label={`Close ${tab.title || tab.url}`}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      send({ type: "close_tab", id: tab.id })
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-2",
          dragging && "ring-2 ring-primary/60 ring-inset"
        )}
        // Files from this computer drop on the page at the same point.
        onDragOver={(event) => {
          if (readOnly || !frame || !event.dataTransfer.types.includes("Files"))
            return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={(event) => {
          setDragging(false)
          if (readOnly || !event.dataTransfer.files.length) return
          event.preventDefault()
          const point = pagePoint(event.clientX, event.clientY)
          if (point) sendFiles(event.dataTransfer.files, point)
        }}
      >
        <textarea
          ref={keysRef}
          aria-label="Keys for the agent's browser"
          className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {!state ? (
          <Spinner />
        ) : !state.open ? (
          <div className="flex max-w-xs flex-col items-center gap-3 text-center text-sm text-muted-foreground">
            <GlobeIcon className="size-6" />
            <span>
              {state.tabs.length > 0
                ? "The agent's browser is closed."
                : "The agent has no browser open. Enter an address to open one."}
            </span>
            {state.tabs.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={readOnly}
                onClick={() => send({ type: "start" })}
              >
                Open again
              </Button>
            ) : null}
          </div>
        ) : frame ? (
          <img
            ref={imageRef}
            src={frame.src}
            alt={activeTab?.title || "The agent's browser"}
            draggable={false}
            className={cn(
              "max-h-full max-w-full rounded-md object-contain shadow-sm ring-1 ring-border/70 select-none",
              "cursor-default",
              "touch-none"
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              touchRef.current = null
            }}
            onWheel={onWheel}
            onContextMenu={(event) => event.preventDefault()}
          />
        ) : (
          <Spinner />
        )}
        {error ? (
          <div className="absolute inset-x-2 bottom-2 truncate rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
