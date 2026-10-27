import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import {
  appendQueueRow,
  hasQueueChanges,
  insertQueueRow,
  isQueueRowChanged,
  laneRows,
  mergeQueueSession,
  mostRecentQueueKey,
  moveQueueRow,
  queueRowsFromMessages,
  queueSessionSavePlan,
  type PendingQueueMessage,
  type PendingQueueSaveRow,
  type QueueEditRow,
  type QueueEditSession,
  type QueueLane,
} from "@/features/pico/pending-queue"

export type ComposerPendingMessagesHandle = {
  /** Start editing at the row queued last. False when the queue is empty. */
  beginEditing: () => boolean
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
   * the held session, or null when the queue must stay paused.
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
  boxClassName: string
  titleClassName: string
  selectedClassName: string
}> = [
  {
    lane: "steer",
    title: "Steer",
    hint: "at the next turn",
    readyIcon: "◆",
    laterIcon: "◇",
    boxClassName: "border-amber-500/40 bg-amber-500/5",
    titleClassName: "text-amber-700 dark:text-amber-300",
    selectedClassName: "bg-amber-500/10 ring-1 ring-amber-500/50",
  },
  {
    lane: "followUp",
    title: "Follow-up",
    hint: "after the run",
    readyIcon: "●",
    laterIcon: "○",
    boxClassName: "border-sky-500/40 bg-sky-500/5",
    titleClassName: "text-sky-700 dark:text-sky-300",
    selectedClassName: "bg-sky-500/10 ring-1 ring-sky-500/50",
  },
]

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
    const [session, setSession] = React.useState<QueueEditSession | null>(null)
    // The hold of the open session: resolves the resume of the held session.
    const holdRef = React.useRef<Promise<(() => void) | null> | null>(null)
    const [heldForEdit, setHeldForEdit] = React.useState(false)
    const editing = session !== null
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
    const sessionRef = React.useRef(session)
    React.useLayoutEffect(() => {
      sessionRef.current = session
    }, [session])

    // Keep an open session in step with prompts that were sent or queued.
    React.useEffect(() => {
      setSession((current) => {
        if (!current) return current
        const next = mergeQueueSession(current, currentPendingMessages)
        return next.rows.length === 0 ? null : next
      })
    }, [currentPendingMessages])

    // Hold the queue while a session is open, so that the agent does not get
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

    /** End the hold of the session; `finish` gets the resume, if any. */
    const releaseHold = React.useCallback(
      (finish: (resume: (() => void) | null) => void) => {
        const hold = holdRef.current ?? Promise.resolve(null)
        holdRef.current = null
        setHeldForEdit(false)
        void hold.then(finish)
      },
      []
    )

    // A session can close by itself, when all its prompts were sent.
    React.useEffect(() => {
      if (editing || !holdRef.current) return
      releaseHold((resume) => resume?.())
    }, [editing, releaseHold])

    // The panel unmounts on a switch to another session. Resume the held
    // session; the resume does not depend on the shown session.
    React.useEffect(
      () => () => {
        const hold = holdRef.current
        holdRef.current = null
        void hold?.then((resume) => resume?.())
      },
      []
    )

    const selectedKey = session?.selectedKey
    const caret = session?.caret
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
        setSession({
          rows: queueRowsFromMessages(currentPendingMessages),
          selectedKey: key,
          caret: "end",
        })
        return true
      },
      [currentPendingMessages]
    )

    const close = React.useCallback(() => {
      setSession(null)
      onExitEditing()
    }, [onExitEditing])

    const end = React.useCallback(() => {
      close()
      releaseHold((resume) => resume?.())
    }, [close, releaseHold])

    const save = React.useCallback(() => {
      const current = sessionRef.current
      if (!current) return
      const plan = hasQueueChanges(current)
        ? queueSessionSavePlan(current)
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
        runEmptyEnter: () => {
          if (sessionRef.current || currentPendingMessages.length === 0) {
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
      ]
    )

    if (currentPendingMessages.length === 0 && !session) return null

    const rows = session?.rows ?? queueRowsFromMessages(currentPendingMessages)
    const unsaved = session ? hasQueueChanges(session) : false
    const selectedRow = session
      ? rows.find((row) => row.key === session.selectedKey)
      : undefined

    const updateSession = (
      update: (current: QueueEditSession) => QueueEditSession | null
    ) => {
      setSession((current) => (current ? update(current) : current))
    }

    const select = (key: string, nextCaret: "start" | "end") => {
      if (!session) {
        begin(key)
        return
      }
      updateSession((current) => ({
        ...current,
        selectedKey: key,
        caret: nextCaret,
      }))
    }

    const selectAdjacent = (direction: -1 | 1) => {
      if (!session) return false
      const index = rows.findIndex((row) => row.key === session.selectedKey)
      const target = rows[index + direction]
      if (!target) return false
      select(target.key, direction === -1 ? "end" : "start")
      return true
    }

    const move = (key: string, direction: -1 | 1) => {
      updateSession((current) => {
        const next = moveQueueRow(current.rows, key, direction)
        return next ? { ...current, rows: next, selectedKey: key } : current
      })
    }

    const insert = (key: string, direction: -1 | 1) => {
      updateSession((current) => {
        const next = insertQueueRow(current.rows, key, direction)
        return next
          ? { rows: next.rows, selectedKey: next.key, caret: "end" }
          : current
      })
    }

    const append = (lane: QueueLane) => {
      if (!session) {
        const next = appendQueueRow(
          queueRowsFromMessages(currentPendingMessages),
          lane
        )
        setSession({ rows: next.rows, selectedKey: next.key, caret: "end" })
        return
      }
      updateSession((current) => {
        const next = appendQueueRow(current.rows, lane)
        return { rows: next.rows, selectedKey: next.key, caret: "end" }
      })
    }

    const toggleRemove = (key: string) => {
      updateSession((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.key === key ? { ...row, removed: !row.removed } : row
        ),
      }))
    }

    const setText = (key: string, text: string) => {
      updateSession((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.key === key ? { ...row, text } : row
        ),
      }))
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

    const firstLane = rows[0]?.lane
    // The hold of an open edit is not a pause.
    const paused = canStartQueue && !heldForEdit
    const selectedLane = selectedRow
      ? laneRows(rows, selectedRow.lane)
      : undefined

    return (
      <div
        className="flex max-h-[min(45vh,420px)] flex-col gap-1.5"
        data-queue-editing={session ? "true" : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {LANES.map((lane) => {
            const items = laneRows(rows, lane.lane)
            if (items.length === 0 && !session) return null

            return (
              <section
                key={lane.lane}
                aria-label={`${lane.title} queue`}
                className={cn(
                  "rounded-xl border px-1.5 pb-1.5",
                  lane.boxClassName
                )}
              >
                <div className="flex min-h-7 items-center gap-2 px-1.5 pt-1 text-xs">
                  <span className={cn("font-medium", lane.titleClassName)}>
                    {lane.title}
                  </span>
                  <span className="text-muted-foreground">
                    {items.length} · {lane.hint}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {!session && lane.lane === firstLane ? (
                      <span className="hidden items-center gap-1 text-muted-foreground md:inline-flex">
                        <Kbd>Alt+Q</Kbd> edit
                      </span>
                    ) : null}
                    {lane.lane === "followUp" && paused ? (
                      <>
                        <span className="text-muted-foreground">⏸ Paused</span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={onStartPendingQueue}
                        >
                          Resume
                        </Button>
                      </>
                    ) : null}
                    {session ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={`Add a ${lane.title.toLowerCase()} row`}
                        onClick={() => append(lane.lane)}
                      >
                        <PlusIcon />
                      </Button>
                    ) : null}
                  </span>
                </div>

                {items.length === 0 ? (
                  <div className="px-1.5 pb-1 text-xs text-muted-foreground">
                    Empty. Move a row here with{" "}
                    <Kbd>{lane.lane === "steer" ? "Alt+↑" : "Alt+↓"}</Kbd>.
                  </div>
                ) : (
                  <ol className="flex flex-col gap-0.5">
                    {items.map((row, index) => {
                      const selected = row.key === session?.selectedKey
                      const icon = rowIcon(row, index, lane, {
                        selected,
                        paused,
                        held: heldForEdit,
                      })
                      const changed = session ? isQueueRowChanged(row) : false

                      return (
                        <li
                          key={row.key}
                          className={cn(
                            "flex items-start gap-2 rounded-lg px-1.5 py-1 text-sm",
                            selected
                              ? lane.selectedClassName
                              : "cursor-text hover:bg-foreground/5"
                          )}
                          onMouseDown={(event) => {
                            if (selected) return
                            event.preventDefault()
                            select(row.key, "end")
                          }}
                        >
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
                            {selected ? (
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
                              />
                            ) : (
                              <div
                                title={row.text || undefined}
                                className={cn(
                                  "truncate leading-6",
                                  row.removed &&
                                    "text-muted-foreground line-through",
                                  !row.text && "text-muted-foreground italic"
                                )}
                              >
                                {row.text.replace(/\s+/g, " ").trim() ||
                                  (row.images.length > 0
                                    ? "Image prompt"
                                    : "Empty prompt")}
                              </div>
                            )}

                            {row.images.length > 0 ||
                            (changed && (row.moved || row.isNew)) ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                {row.images.length > 0 ? (
                                  <span className="inline-flex items-center gap-1">
                                    <ImageIcon className="size-3" />
                                    {row.images.length}
                                  </span>
                                ) : null}
                                {row.isNew ? <span>new</span> : null}
                                {row.moved && !row.isNew ? (
                                  <span>saves in new position</span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {selected ? (
                            <span className="flex shrink-0 items-center">
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                title="Move up"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => move(row.key, -1)}
                              >
                                <ArrowUpIcon />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                title="Move down"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => move(row.key, 1)}
                              >
                                <ArrowDownIcon />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                title={row.removed ? "Keep" : "Remove"}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => toggleRemove(row.key)}
                              >
                                {row.removed ? <Undo2Icon /> : <Trash2Icon />}
                              </Button>
                            </span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            )
          })}
        </div>

        {session ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
            <span className="hidden flex-wrap items-center gap-x-3 gap-y-1 md:flex">
              <span className="inline-flex items-center gap-1">
                <Kbd>↑↓</Kbd> select
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Alt+↑↓</Kbd> move
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Shift+Alt+↑↓</Kbd> insert
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Alt+X</Kbd> remove
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Enter</Kbd> save
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd> cancel
              </span>
            </span>
            {selectedRow && selectedLane ? (
              <span>
                {selectedRow.lane === "steer" ? "steer" : "follow-up"}{" "}
                {selectedLane.indexOf(selectedRow) + 1}/{selectedLane.length}
                {heldForEdit ? " • held while editing" : ""}
                {unsaved ? " • unsaved" : ""}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onMouseDown={(event) => event.preventDefault()}
                onClick={end}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                onMouseDown={(event) => event.preventDefault()}
                onClick={save}
              >
                Save
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    )
  }
)
