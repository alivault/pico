import {
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { type PromptImage } from "@/lib/pi-web"
import { promptImageKey } from "@/features/pi-web/conversation-view"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type ComposerPanelProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  composerImages: Array<PromptImage>
  composerText: string
  isSubmitting: boolean
  isStreaming: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onComposerTextChange: (value: string) => void
  onPickImages: (files: FileList | null) => void
  onRemoveComposerImage: (index: number) => void
  onCreateSession: () => void
  onSubmitPrompt: (streamingBehavior?: "steer" | "followUp") => void
  onAbort: () => void
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
}

export function ComposerPanel({
  currentPendingMessages,
  composerImages,
  composerText,
  isSubmitting,
  isStreaming,
  fileInputRef,
  onComposerTextChange,
  onPickImages,
  onRemoveComposerImage,
  onCreateSession,
  onSubmitPrompt,
  onAbort,
  onRemovePendingMessage,
  onReorderPending,
}: ComposerPanelProps) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        {currentPendingMessages.length > 0 && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Pending prompts</div>
              <Badge variant="outline">{currentPendingMessages.length}</Badge>
            </div>
            <div className="space-y-2">
              {currentPendingMessages.map((message, index) => (
                <div
                  key={message.pendingId}
                  className="rounded-lg border bg-background px-3 py-2"
                >
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      {message.streamingBehavior === "steer"
                        ? "Steer"
                        : "Follow-up"}
                    </Badge>
                    <div className="min-w-0 flex-1 truncate text-sm">
                      {message.pendingId}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => onReorderPending(message.pendingId, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === currentPendingMessages.length - 1}
                      onClick={() => onReorderPending(message.pendingId, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemovePendingMessage(message.pendingId)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="text-sm">
                    {message.text || "Queued image prompt"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {composerImages.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {composerImages.map((image, index) => (
              <div key={promptImageKey(image)} className="relative">
                <img
                  src={image.previewUrl}
                  alt="Attachment preview"
                  className="h-24 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded-full bg-background/90 px-2 py-1 text-xs shadow"
                  onClick={() => onRemoveComposerImage(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          value={composerText}
          onChange={(event) => onComposerTextChange(event.target.value)}
          placeholder={
            isStreaming
              ? "Write a steer or follow-up message…"
              : "Ask Pi to Go anything…"
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              event.preventDefault()
              onSubmitPrompt(isStreaming ? "steer" : undefined)
            }
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => onPickImages(event.target.files)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlusIcon /> Add images
            </Button>
            <Button variant="outline" size="sm" onClick={onCreateSession}>
              <PlusIcon /> New session
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {isStreaming && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => onSubmitPrompt("followUp")}
                >
                  Queue follow-up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => onSubmitPrompt("steer")}
                >
                  Steer now
                </Button>
                <Button variant="outline" size="sm" onClick={onAbort}>
                  Abort
                </Button>
              </>
            )}
            <Button
              disabled={
                isSubmitting ||
                (!composerText.trim() && composerImages.length === 0)
              }
              onClick={() => onSubmitPrompt(isStreaming ? "steer" : undefined)}
            >
              {isSubmitting ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SendIcon />
              )}
              Send
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
