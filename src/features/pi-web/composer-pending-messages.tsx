import { FolderSearchIcon } from "lucide-react"

import type { PromptImage } from "@/lib/pi-web"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

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
      title: "Queue",
      items: messages.filter(
        (message) => message.streamingBehavior !== "steer"
      ),
      emptyLabel: "Queued prompts will run after the current response.",
    },
  ]
}

type ComposerPendingMessagesProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
}

export function ComposerPendingMessages({
  currentPendingMessages,
  onRemovePendingMessage,
  onReorderPending,
}: ComposerPendingMessagesProps) {
  if (currentPendingMessages.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/15 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderSearchIcon className="text-muted-foreground" />
          Pending prompts
        </div>
        <Badge variant="outline">{currentPendingMessages.length}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {groupPendingMessages(currentPendingMessages).map((section) => (
          <div
            key={section.title}
            className="flex flex-col gap-2 rounded-lg border bg-background p-3"
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span>{section.title}</span>
              <span>{section.items.length}</span>
            </div>
            {section.items.length > 0 ? (
              <div className="flex flex-col gap-2">
                {section.items.map((message, index) => (
                  <div
                    key={message.pendingId}
                    className="rounded-md border bg-muted/25 p-2.5"
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">
                        {message.streamingBehavior === "steer"
                          ? "Steer"
                          : "Follow-up"}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {message.pendingId}
                      </span>
                    </div>
                    <div className="line-clamp-3 text-sm">
                      {message.text || "Queued image prompt"}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => onReorderPending(message.pendingId, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={index === section.items.length - 1}
                        onClick={() => onReorderPending(message.pendingId, 1)}
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
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                {section.emptyLabel}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
