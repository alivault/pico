import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import type { ConversationItem, PromptImage } from "@/lib/pi-web"

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:bg-muted prose-code:rounded prose-code:bg-muted/70 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em] prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function promptImageKey(
  image: Pick<PromptImage, "previewUrl" | "data">
) {
  return `${image.previewUrl}:${image.data.slice(0, 24)}`
}

function assistantBlockKey(
  block: Extract<ConversationItem, { kind: "assistant" }>["blocks"][number]
) {
  switch (block.type) {
    case "text":
      return `text:${block.text}`
    case "thinking":
      return `thinking:${block.text}`
    case "tool":
      return `tool:${block.callId || block.name || "tool"}:${block.output}`
    case "compaction":
      return `compaction:${block.tokensBefore}:${block.summary}`
    default:
      return "block"
  }
}

export function conversationItemSignature(item: ConversationItem) {
  if (item.kind === "user") {
    return `user:${item.pendingId || ""}:${item.text}:${item.images
      .map((image) => promptImageKey(image))
      .join(",")}:${item.streamingBehavior || ""}:${item.queued ? "1" : "0"}`
  }

  return `assistant:${item.blocks.map((block) => assistantBlockKey(block)).join("|")}:${
    item.streaming ? "1" : "0"
  }`
}

export function UserMessageCard({
  item,
}: {
  item: Extract<ConversationItem, { kind: "user" }>
}) {
  return (
    <div className="ml-auto w-full max-w-3xl rounded-xl border bg-primary/5 p-4">
      {item.images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {item.images.map((image) => (
            <img
              key={promptImageKey(image)}
              src={image.previewUrl}
              alt="Prompt upload"
              className="h-28 rounded-lg border object-cover"
            />
          ))}
        </div>
      )}
      {item.text ? (
        <MarkdownBlock text={item.text} />
      ) : (
        <div className="text-sm text-muted-foreground">Image prompt</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.queued && <Badge variant="outline">Queued</Badge>}
        {item.streamingBehavior && (
          <Badge variant="outline">
            {item.streamingBehavior === "steer" ? "Steer" : "Follow-up"}
          </Badge>
        )}
      </div>
    </div>
  )
}

export function AssistantMessageCard({
  item,
  hideThinking,
  hiddenThinkingLabel,
}: {
  item: Extract<ConversationItem, { kind: "assistant" }>
  hideThinking: boolean
  hiddenThinkingLabel?: string
}) {
  return (
    <div className="w-full max-w-3xl rounded-xl border bg-card p-4">
      <div className="space-y-4">
        {(() => {
          const counts = new Map<string, number>()
          return item.blocks.map((block) => {
            const baseKey = assistantBlockKey(block)
            const count = (counts.get(baseKey) ?? 0) + 1
            counts.set(baseKey, count)
            const key = `${baseKey}:${count}`

            if (block.type === "text") {
              return <MarkdownBlock key={key} text={block.text} />
            }

            if (block.type === "thinking") {
              if (hideThinking) {
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                  >
                    {hiddenThinkingLabel || "Thinking hidden"}
                  </div>
                )
              }

              return (
                <div key={key} className="rounded-lg border bg-muted/40 p-3">
                  <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Thinking
                  </div>
                  <MarkdownBlock text={block.text} />
                </div>
              )
            }

            if (block.type === "tool") {
              return (
                <div
                  key={key}
                  className="rounded-lg border bg-muted/30 p-3 text-sm"
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <Badge variant="outline">Tool</Badge>
                    <span>{block.name || "tool"}</span>
                    {block.running && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Spinner /> Running
                      </span>
                    )}
                    {block.isError && (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </div>
                  {block.args !== undefined && (
                    <pre className="overflow-x-auto rounded-md bg-background p-2 text-xs">
                      {JSON.stringify(block.args, null, 2)}
                    </pre>
                  )}
                  {block.output && (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-xs whitespace-pre-wrap">
                      {block.output}
                    </pre>
                  )}
                </div>
              )
            }

            if (block.type === "compaction") {
              return (
                <div
                  key={key}
                  className="rounded-lg border bg-muted/30 p-3 text-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline">Compaction</Badge>
                    <span className="text-muted-foreground">
                      {block.tokensBefore.toLocaleString()} tokens before
                    </span>
                  </div>
                  <MarkdownBlock text={block.summary} />
                </div>
              )
            }

            return null
          })
        })()}
      </div>
      {item.streaming && (
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Streaming…
        </div>
      )}
    </div>
  )
}
