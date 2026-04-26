import * as React from "react"

import type { PromptImage } from "@/lib/pi-web"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
}

export const ComposerPendingMessages = React.memo(
  function ComposerPendingMessages({
    currentPendingMessages,
    onRemovePendingMessage,
    onReorderPending,
  }: ComposerPendingMessagesProps) {
    if (currentPendingMessages.length === 0) {
      return null
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
                                size="xs"
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
                                size="xs"
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
                                size="xs"
                                variant="ghost"
                                onClick={() =>
                                  onRemovePendingMessage(message.pendingId)
                                }
                              >
                                Remove
                              </Button>
                            </div>
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
