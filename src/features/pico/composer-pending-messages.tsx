import * as React from "react"

import type { PromptImage } from "@/lib/pico"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

function groupPendingMessages(messages: Array<PendingComposerMessage>) {
  return [
    {
      title: "Steer",
      items: messages.filter(
        (message) => message.streamingBehavior === "steer"
      ),
      emptyLabel: "Steer prompts will interrupt the current response.",
    },
    {
      title: "Follow-up",
      items: messages.filter(
        (message) => message.streamingBehavior !== "steer"
      ),
      emptyLabel: "Follow-up prompts will run after the current response.",
    },
  ]
}

type ComposerPendingMessagesProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  onEditPendingMessage: (pendingId: string, text: string) => void
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
}

type PendingMessageEditState = {
  editingPendingId: string | null
  editText: string
  editError: string | null
}

type PendingMessageEditAction =
  | { type: "begin"; message: PendingComposerMessage }
  | { type: "cancel" }
  | { type: "text"; text: string }
  | { type: "error"; error: string }

const EMPTY_PENDING_MESSAGE_EDIT_STATE: PendingMessageEditState = {
  editingPendingId: null,
  editText: "",
  editError: null,
}

function pendingMessageEditReducer(
  state: PendingMessageEditState,
  action: PendingMessageEditAction
): PendingMessageEditState {
  switch (action.type) {
    case "begin":
      return {
        editingPendingId: action.message.pendingId,
        editText: action.message.text,
        editError: null,
      }
    case "cancel":
      return EMPTY_PENDING_MESSAGE_EDIT_STATE
    case "text":
      return {
        ...state,
        editText: action.text,
        editError: state.editError ? null : state.editError,
      }
    case "error":
      return { ...state, editError: action.error }
  }
}

export const ComposerPendingMessages = React.memo(
  function ComposerPendingMessages({
    currentPendingMessages,
    onEditPendingMessage,
    onRemovePendingMessage,
    onReorderPending,
  }: ComposerPendingMessagesProps) {
    const [editState, dispatchEditState] = React.useReducer(
      pendingMessageEditReducer,
      EMPTY_PENDING_MESSAGE_EDIT_STATE
    )
    const { editingPendingId, editText, editError } = editState

    const editingMessage = editingPendingId
      ? currentPendingMessages.find(
          (message) => message.pendingId === editingPendingId
        )
      : undefined

    React.useEffect(() => {
      if (!editingPendingId) return
      if (editingMessage) return
      dispatchEditState({ type: "cancel" })
    }, [editingMessage, editingPendingId])

    if (currentPendingMessages.length === 0) {
      return null
    }

    const beginEdit = (message: PendingComposerMessage) => {
      dispatchEditState({ type: "begin", message })
    }

    const cancelEdit = () => {
      dispatchEditState({ type: "cancel" })
    }

    const saveEdit = (message: PendingComposerMessage) => {
      if (!editText.trim() && message.images.length === 0) {
        dispatchEditState({
          type: "error",
          error: "Enter a message or keep at least one image.",
        })
        return
      }

      onEditPendingMessage(message.pendingId, editText)
      cancelEdit()
    }

    return (
      <Accordion className="rounded-2xl border bg-card">
        <AccordionItem value="pending-prompts" className="border-0">
          <AccordionTrigger className="min-h-10 items-center gap-3 px-3 py-2 hover:no-underline">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span className="truncate">Queue</span>
              <Badge variant="outline" className="shrink-0">
                {currentPendingMessages.length}
              </Badge>
            </span>
          </AccordionTrigger>

          <AccordionContent className="p-0">
            <div className="max-h-[min(34vh,320px)] overflow-y-auto border-t">
              {groupPendingMessages(currentPendingMessages).map((section) => (
                <section
                  key={section.title}
                  className="border-border/70 not-first:border-t"
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-card px-3 pt-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    <span>{section.title}</span>
                    <span>{section.items.length}</span>
                  </div>

                  <div className="flex flex-col gap-2 px-3 pb-3">
                    {section.items.length > 0 ? (
                      section.items.map((message, index) => {
                        const isSteer = message.streamingBehavior === "steer"
                        const moveUpDisabled = isSteer && index === 0
                        const moveDownDisabled =
                          !isSteer && index === section.items.length - 1

                        return (
                          <div
                            key={message.pendingId}
                            className="rounded-xl border bg-muted/25 p-2.5"
                          >
                            {editingPendingId === message.pendingId ? (
                              <div className="space-y-2">
                                <Textarea
                                  value={editText}
                                  className="min-h-20 resize-none text-base md:text-base"
                                  placeholder={
                                    message.images.length > 0
                                      ? "Optional text for this image prompt"
                                      : "Edit queued message"
                                  }
                                  aria-invalid={Boolean(editError)}
                                  onChange={(event) => {
                                    dispatchEditState({
                                      type: "text",
                                      text: event.target.value,
                                    })
                                  }}
                                  onKeyDown={(event) => {
                                    if (
                                      (event.metaKey || event.ctrlKey) &&
                                      event.key === "Enter"
                                    ) {
                                      event.preventDefault()
                                      saveEdit(message)
                                    }

                                    if (event.key === "Escape") {
                                      event.preventDefault()
                                      cancelEdit()
                                    }
                                  }}
                                />
                                {editError ? (
                                  <div className="text-xs text-destructive">
                                    {editError}
                                  </div>
                                ) : null}
                                {message.images.length > 0 ? (
                                  <div className="text-xs text-muted-foreground">
                                    {message.images.length} image
                                    {message.images.length === 1
                                      ? ""
                                      : "s"}{" "}
                                    kept
                                  </div>
                                ) : null}
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    onClick={() => saveEdit(message)}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={cancelEdit}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="line-clamp-3 text-sm">
                                  {message.text ||
                                    (isSteer
                                      ? "Steer image prompt"
                                      : "Follow-up image prompt")}
                                </div>
                                {message.images.length > 0 ? (
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    {message.images.length} image
                                    {message.images.length === 1 ? "" : "s"}
                                  </div>
                                ) : null}
                                <div className="mt-2 flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={moveUpDisabled}
                                    title={
                                      isSteer
                                        ? "Move up"
                                        : "Move up or promote to steer"
                                    }
                                    onClick={() =>
                                      onReorderPending(message.pendingId, -1)
                                    }
                                  >
                                    ↑
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={moveDownDisabled}
                                    title={
                                      isSteer
                                        ? "Move down or demote to follow-up"
                                        : "Move down"
                                    }
                                    onClick={() =>
                                      onReorderPending(message.pendingId, 1)
                                    }
                                  >
                                    ↓
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => beginEdit(message)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      onRemovePendingMessage(message.pendingId)
                                    }
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                        {section.emptyLabel}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }
)
