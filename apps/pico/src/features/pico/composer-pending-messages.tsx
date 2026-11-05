import * as React from "react"
import {
  closestCorners,
  DndContext,
  DragOverlay,
  MouseSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  ImageIcon,
  KeyboardIcon,
  ListXIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { TitleTooltip } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  QUEUE_COLLAPSED_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"
import {
  getClipboardImageFiles,
  readFileAsPromptImage,
} from "@/features/pico/app-shell-utils"
import { promptImageKey } from "@/features/pico/conversation-view"
import {
  appendQueueRow,
  hasQueueChanges,
  insertQueueRow,
  isQueueRowChanged,
  laneRows,
  mergeQueueAgent,
  mostRecentQueueKey,
  moveQueueRow,
  placeQueueRow,
  queueRowsFromMessages,
  queueAgentSavePlan,
  type PendingQueueMessage,
  type PendingQueueSaveRow,
  type QueueEditRow,
  type QueueEditAgent,
  type QueueLane,
} from "@/features/pico/pending-queue"

export type ComposerPendingMessagesHandle = {
  /** Start editing at the row queued last. False when the queue is empty. */
  beginEditing: () => boolean
  /** Show or hide the queue. False when it is empty or open for editing. */
  toggleCollapsed: () => boolean
  /**
   * Enter on an empty composer: start a paused queue, or send the oldest
   * follow-up as a steer now. False when there is nothing to do.
   */
  runEmptyEnter: () => boolean
}

type ComposerPendingMessagesProps = {
  currentPendingMessages: Array<PendingQueueMessage>
  canStartQueue: boolean
  isStreaming: boolean
  onSavePendingQueue: (
    rows: Array<PendingQueueSaveRow>,
    removedPendingIds: Array<string>,
    resume: boolean
  ) => void
  /**
   * Hold the queue while the user edits it. Resolves a function that resumes
   * the held agent, or null when the queue must stay paused.
   */
  onHoldPendingQueue: () => Promise<(() => void) | null>
  onStartPendingQueue: () => void
  onExitEditing: () => void
  ref?: React.Ref<ComposerPendingMessagesHandle>
}

const LANES: Array<{
  lane: QueueLane
  title: string
  hint: string
  readyIcon: string
  laterIcon: string
  titleClassName: string
  selectedClassName: string
}> = [
  {
    lane: "steer",
    title: "Steer",
    hint: "at the next turn",
    readyIcon: "◆",
    laterIcon: "◇",
    titleClassName: "text-amber-700 dark:text-amber-300",
    selectedClassName: "bg-amber-500/10 ring-1 ring-amber-500/50 ring-inset",
  },
  {
    lane: "followUp",
    title: "Follow-up",
    hint: "after the turn",
    readyIcon: "●",
    laterIcon: "○",
    titleClassName: "text-sky-700 dark:text-sky-300",
    selectedClassName: "bg-sky-500/10 ring-1 ring-sky-500/50 ring-inset",
  },
]

const SHORTCUTS = [
  { title: "Edit the queue", kbd: "Alt+Q" },
  { title: "Show or hide the queue", kbd: "Shift+Alt+Q" },
  { title: "Select", kbd: "↑↓" },
  { title: "Move, also to the other lane", kbd: "Alt+↑↓" },
  { title: "Insert", kbd: "Shift+Alt+↑↓" },
  { title: "Remove", kbd: "Alt+X" },
  { title: "Save", kbd: "Enter" },
  { title: "Cancel", kbd: "Esc" },
]

/** The most images one prompt can have, as in the composer. */
const MAX_PROMPT_IMAGES = 8

function rowIcon(
  row: QueueEditRow,
  index: number,
  lane: (typeof LANES)[number],
  options: { selected: boolean; paused: boolean; held: boolean }
) {
  if (row.removed) return "×"
  if (options.selected) return "›"
  if (options.paused) return "⏸"
  if (options.held) return "◈"
  return index === 0 ? lane.readyIcon : lane.laterIcon
}

/**
 * Drag rows with the mouse only, so that touch keeps its scroll and tap.
 * A press on the editor, a button, or an image does not start a drag.
 */
class QueueRowMouseSensor extends MouseSensor {
  static activators: (typeof MouseSensor)["activators"] = [
    {
      eventName: "onMouseDown",
      handler: ({ nativeEvent: event }, options) => {
        if (event.button !== 0) return false
        const target = event.target
        if (
          target instanceof Element &&
          target.closest("textarea, input, button, img")
        ) {
          return false
        }
        options.onActivation?.({ event })
        return true
      },
    },
  ]
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})
const QUEUE_DRAG_MODIFIERS = [restrictToVerticalAxis]

const LANE_DROP_PREFIX = "queue-lane:"

/** One line of a row that is not edited. */
function QueueRowSummary({ row }: { row: QueueEditRow }) {
  return (
    <div
      title={row.text || undefined}
      className={cn(
        "truncate leading-6",
        row.removed && "text-muted-foreground line-through",
        !row.text && "text-muted-foreground italic"
      )}
    >
      {row.text.replace(/\s+/g, " ").trim() ||
        (row.images.length > 0 ? "Image prompt" : "Empty prompt")}
    </div>
  )
}

function QueueLaneSection({
  lane,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { lane: QueueLane }) {
  const { setNodeRef } = useDroppable({ id: `${LANE_DROP_PREFIX}${lane}` })
  return (
    <section ref={setNodeRef} className={className} {...props}>
      {children}
    </section>
  )
}

function SortableQueueRow({
  id,
  disabled,
  className,
  onMouseDown,
  onClick,
  children,
}: {
  id: string
  disabled: boolean
  className: string
  onMouseDown: (event: React.MouseEvent<HTMLLIElement>) => void
  onClick: () => void
  children: React.ReactNode
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(className, isDragging && "invisible")}
      onMouseDown={(event) => {
        listeners?.onMouseDown?.(event)
        onMouseDown(event)
      }}
      onClick={onClick}
    >
      {children}
    </li>
  )
}

function isCaretOnFirstLine(textarea: HTMLTextAreaElement) {
  if (textarea.selectionStart !== textarea.selectionEnd) return false
  return !textarea.value.slice(0, textarea.selectionStart).includes("\n")
}

function isCaretOnLastLine(textarea: HTMLTextAreaElement) {
  if (textarea.selectionStart !== textarea.selectionEnd) return false
  return !textarea.value.slice(textarea.selectionEnd).includes("\n")
}

export const ComposerPendingMessages = React.memo(
  function ComposerPendingMessages({
    currentPendingMessages,
    canStartQueue,
    isStreaming,
    onSavePendingQueue,
    onHoldPendingQueue,
    onStartPendingQueue,
    onExitEditing,
    ref,
  }: ComposerPendingMessagesProps) {
    const [agent, setAgent] = React.useState<QueueEditAgent | null>(null)
    // The hold of the open agent: resolves the resume of the held agent.
    const holdRef = React.useRef<Promise<(() => void) | null> | null>(null)
    const [heldForEdit, setHeldForEdit] = React.useState(false)
    const editing = agent !== null
    const editorRef = React.useRef<HTMLTextAreaElement | null>(null)
    // A move to the other lane mounts a new editor. Keep the focus and caret.
    const attachEditor = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        // Keep the last editor on unmount, to read its caret.
        if (!node) return
        const previous = editorRef.current
        editorRef.current = node
        if (!previous || previous === node) return
        if (previous.isConnected && previous !== document.activeElement) return
        const { selectionStart, selectionEnd } = previous
        node.focus({ preventScroll: true })
        node.setSelectionRange(selectionStart, selectionEnd)
        node.scrollIntoView({ block: "nearest" })
      },
      []
    )
    const agentRef = React.useRef(agent)
    React.useLayoutEffect(() => {
      agentRef.current = agent
    }, [agent])

    // Keep an open agent in step with prompts that were sent or queued.
    React.useEffect(() => {
      setAgent((current) => {
        if (!current) return current
        const next = mergeQueueAgent(current, currentPendingMessages)
        return next.rows.length === 0 ? null : next
      })
    }, [currentPendingMessages])

    // Hold the queue while an agent is open, so that the agent does not get
    // a prompt with old text. Only server prompts can be held.
    React.useEffect(() => {
      if (!editing || holdRef.current) return
      const hasServerPrompts = currentPendingMessages.some((message) =>
        /^(pending|held):/.test(message.pendingId)
      )
      const hold = hasServerPrompts
        ? onHoldPendingQueue().catch(() => null)
        : Promise.resolve(null)
      holdRef.current = hold
      void hold.then((resume) => {
        if (holdRef.current === hold) setHeldForEdit(resume !== null)
      })
    }, [currentPendingMessages, editing, onHoldPendingQueue])

    /** End the hold of the agent; `finish` gets the resume, if any. */
    const releaseHold = React.useCallback(
      (finish: (resume: (() => void) | null) => void) => {
        const hold = holdRef.current ?? Promise.resolve(null)
        holdRef.current = null
        setHeldForEdit(false)
        void hold.then(finish)
      },
      []
    )

    // An agent can close by itself, when all its prompts were sent.
    React.useEffect(() => {
      if (editing || !holdRef.current) return
      releaseHold((resume) => resume?.())
    }, [editing, releaseHold])

    // The panel unmounts on a switch to another agent. Resume the held
    // agent; the resume does not depend on the shown agent.
    React.useEffect(
      () => () => {
        const hold = holdRef.current
        holdRef.current = null
        void hold?.then((resume) => resume?.())
      },
      []
    )

    // A collapsed queue shows only its header. An open editor shows all.
    const [collapsedQueue, setCollapsedQueue] = React.useState(
      () => safeLocalStorageGetItem(QUEUE_COLLAPSED_STORAGE_KEY) === "1"
    )
    const toggleCollapsed = React.useCallback(() => {
      setCollapsedQueue((current) => {
        safeLocalStorageSetItem(
          QUEUE_COLLAPSED_STORAGE_KEY,
          current ? "0" : "1"
        )
        return !current
      })
    }, [])

    const isMobile = useIsMobile()
    const dragSensors = useSensors(
      useSensor(QueueRowMouseSensor, { activationConstraint: { distance: 6 } })
    )
    const [dragKey, setDragKey] = React.useState<string | null>(null)
    // The rows before the drag, to restore them when the drag is cancelled.
    const dragStartRowsRef = React.useRef<Array<QueueEditRow> | null>(null)

    const selectedKey = agent?.selectedKey
    const caret = agent?.caret
    React.useLayoutEffect(() => {
      const editor = editorRef.current
      if (!editor || !selectedKey) return
      editor.focus({ preventScroll: true })
      const position = caret === "start" ? 0 : editor.value.length
      editor.setSelectionRange(position, position)
      editor.scrollIntoView({ block: "nearest" })
    }, [selectedKey, caret])

    const begin = React.useCallback(
      (key: string | undefined) => {
        if (!key) return false
        setAgent({
          rows: queueRowsFromMessages(currentPendingMessages),
          selectedKey: key,
          caret: "end",
        })
        return true
      },
      [currentPendingMessages]
    )

    const close = React.useCallback(() => {
      setAgent(null)
      onExitEditing()
    }, [onExitEditing])

    const end = React.useCallback(() => {
      close()
      releaseHold((resume) => resume?.())
    }, [close, releaseHold])

    const save = React.useCallback(() => {
      const current = agentRef.current
      if (!current) return
      const plan = hasQueueChanges(current)
        ? queueAgentSavePlan(current)
        : undefined
      close()
      releaseHold((resume) => {
        if (plan) {
          onSavePendingQueue(plan.rows, plan.removedPendingIds, resume !== null)
        } else {
          resume?.()
        }
      })
    }, [close, onSavePendingQueue, releaseHold])

    React.useImperativeHandle(
      ref,
      () => ({
        beginEditing: () => begin(mostRecentQueueKey(currentPendingMessages)),
        toggleCollapsed: () => {
          if (agentRef.current || currentPendingMessages.length === 0) {
            return false
          }
          toggleCollapsed()
          return true
        },
        runEmptyEnter: () => {
          if (agentRef.current || currentPendingMessages.length === 0) {
            return false
          }
          if (canStartQueue) {
            onStartPendingQueue()
            return true
          }
          if (!isStreaming) return false

          const rows = queueRowsFromMessages(currentPendingMessages)
          const oldest = laneRows(rows, "followUp")[0]
          if (!oldest) return false
          const next = moveQueueRow(rows, oldest.key, -1)
          if (!next) return false
          onSavePendingQueue(
            next.map((row) => ({
              ...(row.pendingId ? { pendingId: row.pendingId } : {}),
              text: row.text,
              images: row.images,
              streamingBehavior: row.lane,
            })),
            [],
            false
          )
          return true
        },
      }),
      [
        begin,
        canStartQueue,
        currentPendingMessages,
        isStreaming,
        onSavePendingQueue,
        onStartPendingQueue,
        toggleCollapsed,
      ]
    )

    if (currentPendingMessages.length === 0 && !agent) return null

    const rows = agent?.rows ?? queueRowsFromMessages(currentPendingMessages)
    const unsaved = agent ? hasQueueChanges(agent) : false
    const selectedRow = agent
      ? rows.find((row) => row.key === agent.selectedKey)
      : undefined

    const updateAgent = (
      update: (current: QueueEditAgent) => QueueEditAgent | null
    ) => {
      setAgent((current) => (current ? update(current) : current))
    }

    const select = (key: string, nextCaret: "start" | "end") => {
      if (!agent) {
        begin(key)
        return
      }
      updateAgent((current) => ({
        ...current,
        selectedKey: key,
        caret: nextCaret,
      }))
    }

    const selectAdjacent = (direction: -1 | 1) => {
      if (!agent) return false
      const index = rows.findIndex((row) => row.key === agent.selectedKey)
      const target = rows[index + direction]
      if (!target) return false
      select(target.key, direction === -1 ? "end" : "start")
      return true
    }

    const move = (key: string, direction: -1 | 1) => {
      updateAgent((current) => {
        const next = moveQueueRow(current.rows, key, direction)
        return next ? { ...current, rows: next, selectedKey: key } : current
      })
    }

    const insert = (key: string, direction: -1 | 1) => {
      updateAgent((current) => {
        const next = insertQueueRow(current.rows, key, direction)
        return next
          ? { rows: next.rows, selectedKey: next.key, caret: "end" }
          : current
      })
    }

    const append = (lane: QueueLane) => {
      if (!agent) {
        const next = appendQueueRow(
          queueRowsFromMessages(currentPendingMessages),
          lane
        )
        setAgent({ rows: next.rows, selectedKey: next.key, caret: "end" })
        return
      }
      updateAgent((current) => {
        const next = appendQueueRow(current.rows, lane)
        return { rows: next.rows, selectedKey: next.key, caret: "end" }
      })
    }

    const toggleRemove = (key: string) => {
      updateAgent((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.key === key ? { ...row, removed: !row.removed } : row
        ),
      }))
    }

    // Mark all rows to remove, or keep them all again. Save removes them.
    const allRemoved = rows.every((row) => row.removed)
    const toggleRemoveAll = () => {
      const mark = (current: Array<QueueEditRow>) =>
        current.map((row) => ({ ...row, removed: !allRemoved }))
      if (!agent) {
        const key = mostRecentQueueKey(currentPendingMessages) ?? rows[0]?.key
        if (!key) return
        setAgent({
          rows: mark(rows),
          selectedKey: key,
          caret: "end",
        })
        return
      }
      updateAgent((current) => ({ ...current, rows: mark(current.rows) }))
    }

    const setText = (key: string, text: string) => {
      updateAgent((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.key === key ? { ...row, text } : row
        ),
      }))
    }

    const setImages = (
      key: string,
      update: (images: QueueEditRow["images"]) => QueueEditRow["images"]
    ) => {
      updateAgent((current) => ({
        ...current,
        rows: current.rows.map((row) => {
          if (row.key !== key) return row
          const images = update(row.images)
          // Removing the added images gives back the original row.
          const same =
            images.length === row.originalImages.length &&
            images.every((image, index) => image === row.originalImages[index])
          return { ...row, images: same ? row.originalImages : images }
        }),
      }))
    }

    const handleEditorPaste = (
      event: React.ClipboardEvent<HTMLTextAreaElement>,
      row: QueueEditRow
    ) => {
      const files = getClipboardImageFiles(event.clipboardData)
      if (files.length === 0) return
      void Promise.all(
        files.slice(0, MAX_PROMPT_IMAGES).map(readFileAsPromptImage)
      ).then((added) =>
        setImages(row.key, (images) =>
          [...images, ...added].slice(0, MAX_PROMPT_IMAGES)
        )
      )
    }

    const handleEditorKeyDown = (
      event: React.KeyboardEvent<HTMLTextAreaElement>,
      row: QueueEditRow
    ) => {
      if (event.nativeEvent.isComposing) return
      const textarea = event.currentTarget
      const arrow =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
      const handled = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (arrow && event.altKey && !event.metaKey && !event.ctrlKey) {
        handled()
        if (event.shiftKey) insert(row.key, arrow)
        else move(row.key, arrow)
        return
      }

      if (
        arrow &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (arrow === -1
          ? isCaretOnFirstLine(textarea)
          : isCaretOnLastLine(textarea))
      ) {
        if (selectAdjacent(arrow)) handled()
        return
      }

      if (
        event.code === "KeyX" &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        handled()
        toggleRemove(row.key)
        return
      }

      if (event.key === "Enter" && !event.shiftKey) {
        handled()
        save()
        return
      }

      if (event.key === "Escape") {
        handled()
        end()
      }
    }

    const dragRow = dragKey
      ? rows.find((row) => row.key === dragKey)
      : undefined

    /** The lane and the row (if any) under the pointer. */
    const dropTarget = (overId: string) => {
      if (overId.startsWith(LANE_DROP_PREFIX)) {
        return {
          lane: overId.slice(LANE_DROP_PREFIX.length) as QueueLane,
          row: undefined,
        }
      }
      const row = rows.find((entry) => entry.key === overId)
      return row ? { lane: row.lane, row } : null
    }

    // A drag opens the editor at the dragged row. The editor has the same
    // layout, so that the rows do not move under the pointer.
    const handleDragStart = (event: DragStartEvent) => {
      const key = String(event.active.id)
      dragStartRowsRef.current = agentRef.current?.rows ?? rows
      if (!agentRef.current) begin(key)
      setDragKey(key)
    }

    // A row that goes over the other lane moves to that lane at once, so
    // that the lane opens a place for it.
    const handleDragOver = ({ active, over }: DragOverEvent) => {
      if (!over) return
      const key = String(active.id)
      const row = rows.find((entry) => entry.key === key)
      const target = dropTarget(String(over.id))
      if (!row || !target || target.lane === row.lane) return

      const laneItems = laneRows(rows, target.lane)
      let index = laneItems.length
      if (target.row) {
        const activeRect = active.rect.current.translated
        const below =
          activeRect !== null &&
          activeRect.top + activeRect.height / 2 >
            over.rect.top + over.rect.height / 2
        index = laneItems.indexOf(target.row) + (below ? 1 : 0)
      }
      updateAgent((current) => {
        const next = placeQueueRow(current.rows, key, target.lane, index)
        return next ? { ...current, rows: next } : current
      })
    }

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
      setDragKey(null)
      dragStartRowsRef.current = null
      if (!over) return
      const key = String(active.id)
      const target = dropTarget(String(over.id))
      if (!target?.row || target.row.key === key) return
      const overRow = target.row
      updateAgent((current) => {
        const index = laneRows(current.rows, target.lane).findIndex(
          (row) => row.key === overRow.key
        )
        if (index === -1) return current
        const next = placeQueueRow(current.rows, key, target.lane, index)
        return next ? { ...current, rows: next, selectedKey: key } : current
      })
    }

    const handleDragCancel = () => {
      const startRows = dragStartRowsRef.current
      setDragKey(null)
      dragStartRowsRef.current = null
      if (startRows) updateAgent((current) => ({ ...current, rows: startRows }))
    }

    // The hold of an open edit is not a pause.
    const paused = canStartQueue && !heldForEdit
    const selectedLane = selectedRow
      ? LANES.find((lane) => lane.lane === selectedRow.lane)
      : undefined
    const selectedLaneRows = selectedRow
      ? laneRows(rows, selectedRow.lane)
      : undefined
    const keepFocus = (event: React.MouseEvent) => event.preventDefault()
    const collapsed = collapsedQueue && !editing

    return (
      <div
        className="flex max-h-[min(45vh,420px)] flex-col rounded-xl border bg-muted/30 p-1"
        data-queue-editing={agent ? "true" : undefined}
      >
        {/* One header for both modes, so that the queue keeps its height
            when editing starts. A click on the header, but not on its
            buttons, shows or hides the queue. */}
        <div
          className="flex h-7 shrink-0 items-center gap-2 pr-0.5 pl-2 text-xs"
          onMouseDown={(event) => {
            if (!editing) keepFocus(event)
          }}
          onClick={(event) => {
            if (editing) return
            const target = event.target
            if (target instanceof Element && target.closest("button")) return
            toggleCollapsed()
          }}
        >
          <button
            type="button"
            aria-expanded={!collapsed}
            disabled={editing}
            title={`${collapsed ? "Show" : "Hide"} the queue (Shift+Alt+Q)`}
            className="-ml-1 flex shrink-0 items-center gap-1 rounded-sm pr-1 font-medium hover:bg-foreground/5 disabled:hover:bg-transparent"
            onMouseDown={keepFocus}
            onClick={toggleCollapsed}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                !collapsed && "rotate-90",
                editing && "invisible"
              )}
            />
            {editing ? "Editing" : "Queue"}
          </button>
          <span className="-ml-1 min-w-0 truncate text-muted-foreground">
            {selectedRow && selectedLane && selectedLaneRows
              ? `${selectedLane.title} ${selectedLaneRows.indexOf(selectedRow) + 1} of ${selectedLaneRows.length}`
              : `${rows.length} ${rows.length === 1 ? "prompt" : "prompts"}`}
            {heldForEdit ? " · held" : ""}
            {unsaved ? " · unsaved" : ""}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {paused ? (
              <Button
                size="xs"
                variant="outline"
                onMouseDown={keepFocus}
                onClick={onStartPendingQueue}
              >
                <PlayIcon />
                Resume
              </Button>
            ) : null}
            {isMobile ? null : (
              <TitleTooltip title="Shortcuts" rows={SHORTCUTS}>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Shortcuts"
                  onMouseDown={keepFocus}
                >
                  <KeyboardIcon />
                </Button>
              </TitleTooltip>
            )}
            <TitleTooltip title={allRemoved ? "Keep all" : "Remove all"}>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={allRemoved ? "Keep all" : "Remove all"}
                onMouseDown={keepFocus}
                onClick={toggleRemoveAll}
              >
                {allRemoved ? <Undo2Icon /> : <ListXIcon />}
              </Button>
            </TitleTooltip>
            {agent ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  onMouseDown={keepFocus}
                  onClick={end}
                >
                  Cancel
                </Button>
                <Button size="xs" onMouseDown={keepFocus} onClick={save}>
                  Save
                </Button>
              </>
            ) : (
              <TitleTooltip title="Edit the queue" kbd="Alt+Q">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    begin(mostRecentQueueKey(currentPendingMessages))
                  }
                >
                  Edit
                </Button>
              </TitleTooltip>
            )}
          </span>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto",
            collapsed && "hidden"
          )}
        >
          <DndContext
            sensors={dragSensors}
            collisionDetection={closestCorners}
            modifiers={QUEUE_DRAG_MODIFIERS}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {LANES.map((lane) => {
              const items = laneRows(rows, lane.lane)

              return (
                <QueueLaneSection
                  key={lane.lane}
                  lane={lane.lane}
                  aria-label={`${lane.title} queue`}
                >
                  <div className="flex h-6 items-center gap-1 pr-0.5 pl-1 text-xs">
                    <span className={cn("font-medium", lane.titleClassName)}>
                      {lane.title}
                    </span>
                    {items.length > 0 ? (
                      <span className="text-muted-foreground tabular-nums">
                        {items.length}
                      </span>
                    ) : null}
                    <span className="truncate text-muted-foreground">
                      · {lane.hint}
                    </span>
                    <TitleTooltip title={`Add a ${lane.title.toLowerCase()}`}>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Add a ${lane.title.toLowerCase()}`}
                        className="ml-auto"
                        onMouseDown={keepFocus}
                        onClick={() => append(lane.lane)}
                      >
                        <PlusIcon />
                      </Button>
                    </TitleTooltip>
                  </div>

                  {items.length === 0 ? (
                    // An empty lane: a click adds a prompt to it.
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-sm text-muted-foreground hover:bg-foreground/5"
                      onMouseDown={keepFocus}
                      onClick={() => append(lane.lane)}
                    >
                      {isMobile ? null : (
                        <span aria-hidden="true" className="w-3.5 shrink-0" />
                      )}
                      <PlusIcon
                        aria-hidden="true"
                        className={cn("size-3.5 shrink-0", lane.titleClassName)}
                      />
                      <span className="truncate leading-6 italic">
                        Click to add a {lane.title.toLowerCase()}
                      </span>
                    </button>
                  ) : (
                    <SortableContext
                      items={items.map((row) => row.key)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ol className="flex flex-col">
                        {items.map((row, index) => {
                          const selected = row.key === agent?.selectedKey
                          // A dragged row stays one line high.
                          const editing = selected && row.key !== dragKey
                          const icon = rowIcon(row, index, lane, {
                            selected,
                            paused,
                            held: heldForEdit,
                          })
                          const changed = agent ? isQueueRowChanged(row) : false

                          return (
                            <SortableQueueRow
                              key={row.key}
                              id={row.key}
                              disabled={isMobile}
                              className={cn(
                                "group/row flex items-start gap-1.5 rounded-lg px-1 py-0.5 text-sm",
                                selected
                                  ? lane.selectedClassName
                                  : "cursor-default hover:bg-foreground/5"
                              )}
                              onMouseDown={(event) => {
                                if (!selected) keepFocus(event)
                              }}
                              onClick={() => {
                                if (!selected) select(row.key, "end")
                              }}
                            >
                              {isMobile ? null : (
                                <span
                                  aria-hidden="true"
                                  className="flex h-6 shrink-0 cursor-grab items-center text-muted-foreground/40 group-hover/row:text-muted-foreground active:cursor-grabbing"
                                >
                                  <GripVerticalIcon className="size-3.5" />
                                </span>
                              )}
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "w-3.5 shrink-0 text-center leading-6 select-none",
                                  row.removed
                                    ? "text-destructive"
                                    : lane.titleClassName
                                )}
                              >
                                {icon}
                              </span>

                              <div className="min-w-0 flex-1">
                                {editing ? (
                                  <textarea
                                    ref={attachEditor}
                                    value={row.text}
                                    rows={1}
                                    aria-label={`Edit ${lane.title.toLowerCase()} prompt ${index + 1}`}
                                    placeholder={
                                      row.images.length > 0
                                        ? "Optional text for this image prompt"
                                        : "Type a prompt"
                                    }
                                    className={cn(
                                      "block field-sizing-content max-h-60 min-h-6 w-full resize-none bg-transparent leading-6 outline-none placeholder:text-muted-foreground",
                                      row.removed && "line-through opacity-60"
                                    )}
                                    onChange={(event) =>
                                      setText(row.key, event.target.value)
                                    }
                                    onKeyDown={(event) =>
                                      handleEditorKeyDown(event, row)
                                    }
                                    onPaste={(event) =>
                                      handleEditorPaste(event, row)
                                    }
                                  />
                                ) : (
                                  <QueueRowSummary row={row} />
                                )}

                                {editing && row.images.length > 0 ? (
                                  <div className="flex flex-wrap gap-2 py-1">
                                    {row.images.map((image, imageIndex) => (
                                      <div
                                        key={promptImageKey(image)}
                                        className="relative"
                                      >
                                        <img
                                          src={image.previewUrl}
                                          alt="Attachment preview"
                                          className="h-12 rounded-md border object-cover"
                                        />
                                        <Button
                                          type="button"
                                          size="icon-xs"
                                          variant="ghost"
                                          title="Remove image"
                                          className="absolute top-0.5 right-0.5 size-5 rounded-full bg-background/90 shadow-sm"
                                          onMouseDown={keepFocus}
                                          onClick={() =>
                                            setImages(row.key, (images) =>
                                              images.filter(
                                                (_, index) =>
                                                  index !== imageIndex
                                              )
                                            )
                                          }
                                        >
                                          <XIcon className="size-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              {/* The tags stay on the line of the row, so
                                  that they do not change its height. */}
                              {changed && row.isNew ? (
                                <span className="shrink-0 text-xs leading-6 text-muted-foreground">
                                  new
                                </span>
                              ) : changed && row.moved ? (
                                <span className="shrink-0 text-xs leading-6 text-muted-foreground">
                                  moved
                                </span>
                              ) : null}
                              {!editing && row.images.length > 0 ? (
                                <span className="flex h-6 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                  <ImageIcon className="size-3" />
                                  {row.images.length}
                                </span>
                              ) : null}

                              {editing ? (
                                <span className="flex shrink-0 items-center">
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    title="Move up"
                                    onMouseDown={keepFocus}
                                    onClick={() => move(row.key, -1)}
                                  >
                                    <ArrowUpIcon />
                                  </Button>
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    title="Move down"
                                    onMouseDown={keepFocus}
                                    onClick={() => move(row.key, 1)}
                                  >
                                    <ArrowDownIcon />
                                  </Button>
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    title={row.removed ? "Keep" : "Remove"}
                                    onMouseDown={keepFocus}
                                    onClick={() => toggleRemove(row.key)}
                                  >
                                    {row.removed ? (
                                      <Undo2Icon />
                                    ) : (
                                      <Trash2Icon />
                                    )}
                                  </Button>
                                </span>
                              ) : null}
                            </SortableQueueRow>
                          )
                        })}
                      </ol>
                    </SortableContext>
                  )}
                </QueueLaneSection>
              )
            })}
            <DragOverlay dropAnimation={null}>
              {dragRow ? (
                <div className="flex cursor-grabbing items-start gap-1.5 rounded-lg border bg-background px-1 py-0.5 text-sm opacity-70 shadow-md">
                  <span
                    aria-hidden="true"
                    className="flex h-6 shrink-0 items-center text-muted-foreground"
                  >
                    <GripVerticalIcon className="size-3.5" />
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "w-3.5 shrink-0 text-center leading-6 select-none",
                      LANES.find((lane) => lane.lane === dragRow.lane)
                        ?.titleClassName
                    )}
                  >
                    ›
                  </span>
                  <div className="min-w-0 flex-1">
                    <QueueRowSummary row={dragRow} />
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    )
  }
)
