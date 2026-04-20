"use client"

/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: syntax highlighting HTML is generated server-side by highlight.js */

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { CheckIcon, CopyIcon, WrenchIcon } from "lucide-react"

import type { ConversationItem, PromptImage } from "@/lib/pi-web"
import type { HighlightResponse } from "@/lib/pi-web-api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const highlightCache = new Map<
  string,
  Promise<HighlightResponse> | HighlightResponse
>()

function parseCodeLanguage(className?: string) {
  const match = className?.match(/language-([\w-]+)/)
  return match?.[1]
}

async function getHighlightedCode(code: string, language?: string) {
  const cacheKey = `${language || "plaintext"}\u0000${code}`
  const cached = highlightCache.get(cacheKey)
  if (cached) {
    return await cached
  }

  const promise = fetch("/api/highlight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, language }),
  }).then(async (response) => {
    const payload = (await response.json()) as HighlightResponse
    return payload
  })

  highlightCache.set(cacheKey, promise)
  const payload = await promise
  highlightCache.set(cacheKey, payload)
  return payload
}

function CodeBlock({
  code,
  language,
}: {
  code: string
  language?: string
}) {
  const [highlighted, setHighlighted] = React.useState<HighlightResponse | null>(null)
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">(
    "idle"
  )

  React.useEffect(() => {
    let cancelled = false

    void getHighlightedCode(code, language).then((payload) => {
      if (!cancelled) {
        setHighlighted(payload)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, language])

  const renderedLanguage =
    highlighted && "language" in highlighted && highlighted.language
      ? highlighted.language
      : language

  const copyCode = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1400)
    } catch {
      setCopyState("error")
      window.setTimeout(() => setCopyState("idle"), 1400)
    }
  }, [code])

  const highlightedHtml = hasHighlightHtml(highlighted)
    ? highlighted.html
    : null

  const highlightedMarkup = React.useMemo(
    () => ({ __html: highlightedHtml || "" }),
    [highlightedHtml]
  )

  const highlightedContent = React.useMemo(() => {
    if (!highlightedHtml) return null

    return React.createElement("code", {
      className: cn("hljs", renderedLanguage && `language-${renderedLanguage}`),
      // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax highlighting HTML is generated server-side by highlight.js
      dangerouslySetInnerHTML: highlightedMarkup,
    })
  }, [highlightedHtml, highlightedMarkup, renderedLanguage])

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b bg-background/80 px-3 py-2 text-xs text-muted-foreground">
        <div className="truncate font-medium uppercase tracking-wide">
          {renderedLanguage || "code"}
        </div>
        <Button variant="ghost" size="xs" onClick={copyCode}>
          {copyState === "copied" ? (
            <CheckIcon data-icon="inline-start" />
          ) : (
            <CopyIcon data-icon="inline-start" />
          )}
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Retry"
              : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-6">
        {highlightedContent || <code>{code}</code>}
      </pre>
    </div>
  )
}

function isHighlightSkipped(payload: HighlightResponse) {
  return (
    "skipped" in payload ||
    "unsupported" in payload ||
    "unavailable" in payload ||
    ("ok" in payload && payload.ok === false)
  )
}

function isHighlightUnavailable(payload: HighlightResponse) {
  return "unavailable" in payload || ("ok" in payload && payload.ok === false)
}

function hasHighlightHtml(
  payload: HighlightResponse | null
): payload is Exclude<
  HighlightResponse,
  { ok: false; error: string; routePath?: string }
> & { html: string } {
  return Boolean(payload && !isHighlightSkipped(payload) && !isHighlightUnavailable(payload))
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:m-0 max-w-none break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const code = String(children).replace(/\n$/, "")
            const language = parseCodeLanguage(className)

            if (!className) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]"
                  {...props}
                >
                  {children}
                </code>
              )
            }

            return <CodeBlock code={code} language={language} />
          },
          pre({ children }) {
            return <>{children}</>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export function promptImageKey(
  image: Pick<PromptImage, "previewUrl" | "data">
) {
  return `${image.previewUrl}:${image.data.slice(0, 24)}`
}

function assistantBlockKey(
  block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]
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
    <div className="ml-auto w-full max-w-3xl rounded-2xl border bg-primary/6 p-4 shadow-sm">
      {item.images.length > 0 ? (
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
      ) : null}
      {item.text ? (
        <MarkdownBlock text={item.text} />
      ) : (
        <div className="text-sm text-muted-foreground">Image prompt</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.queued ? <Badge variant="outline">Queued</Badge> : null}
        {item.streamingBehavior ? (
          <Badge variant="outline">
            {item.streamingBehavior === "steer" ? "Steer" : "Follow-up"}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

export function AssistantMessageCard({
  item,
  hideThinking,
  hideToolBlocks,
  hiddenThinkingLabel,
}: {
  item: Extract<ConversationItem, { kind: "assistant" }>
  hideThinking: boolean
  hideToolBlocks: boolean
  hiddenThinkingLabel?: string
}) {
  return (
    <div className="w-full max-w-3xl rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4">
        {(() => {
          const counts = new Map<string, number>()
          return item.blocks.map((block) => {
            const baseKey = assistantBlockKey(block)
            const count = (counts.get(baseKey) ?? 0) + 1
            counts.set(baseKey, count)
            const key = `${baseKey}:${count}`

            switch (block.type) {
              case "text":
                return <MarkdownBlock key={key} text={block.text} />
              case "thinking":
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
                  <div key={key} className="rounded-xl border bg-muted/35 p-3">
                    <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Thinking
                    </div>
                    <MarkdownBlock text={block.text} />
                  </div>
                )
              case "tool":
                if (hideToolBlocks) {
                  return null
                }

                return (
                  <div key={key} className="rounded-xl border bg-muted/25 p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-2 font-medium">
                      <Badge variant="outline">
                        <WrenchIcon data-icon="inline-start" />
                        Tool
                      </Badge>
                      <span>{block.name || "tool"}</span>
                      {block.running ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Spinner /> Running
                        </span>
                      ) : null}
                      {block.isError ? <Badge variant="destructive">Error</Badge> : null}
                    </div>
                    {block.args !== undefined ? (
                      <div className="mb-2 overflow-x-auto rounded-lg border bg-background/80 p-3 text-xs">
                        <pre>{JSON.stringify(block.args, null, 2)}</pre>
                      </div>
                    ) : null}
                    {block.output ? (
                      <div className="overflow-x-auto rounded-lg border bg-background/80 p-3 text-xs whitespace-pre-wrap">
                        <pre>{block.output}</pre>
                      </div>
                    ) : null}
                  </div>
                )
              case "compaction":
                return (
                  <div key={key} className="rounded-xl border bg-muted/25 p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Compaction</Badge>
                      <span className="text-muted-foreground">
                        {block.tokensBefore.toLocaleString()} tokens before
                      </span>
                    </div>
                    <MarkdownBlock text={block.summary} />
                  </div>
                )
              default:
                return null
            }
          })
        })()}
      </div>
      {item.streaming ? (
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Streaming…
        </div>
      ) : null}
    </div>
  )
}
