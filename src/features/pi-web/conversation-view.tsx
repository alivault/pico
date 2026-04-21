"use client"

/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: syntax highlighting HTML is generated server-side by highlight.js */

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { CheckIcon, ChevronRightIcon, CopyIcon, WrenchIcon } from "lucide-react"

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

function toolArgsKey(args: unknown) {
  if (typeof args === "string") return args
  if (args == null) return ""

  try {
    return JSON.stringify(args)
  } catch {
    return ""
  }
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
      return `tool:${block.callId || block.name || "tool"}:${toolArgsKey(block.args)}`
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

function userMessageLabel(item: Extract<ConversationItem, { kind: "user" }>) {
  if (item.streamingBehavior === "steer") return "Steer"
  if (item.queued || item.streamingBehavior === "followUp") return "Queue"
  return ""
}

function toolDisplayName(name?: string) {
  switch (name) {
    case "bash":
      return "Shell"
    case "read":
      return "Read"
    case "write":
      return "Write"
    case "edit":
      return "Edit"
    case "grep":
      return "Search"
    case "find":
      return "Find"
    case "ls":
      return "List"
    default:
      return name || "Tool"
  }
}

function normalizeToolArgs(args: unknown) {
  if (!args) return undefined
  if (typeof args === "object") {
    return args as Record<string, unknown>
  }
  if (typeof args !== "string") return undefined

  try {
    const parsed = JSON.parse(args)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function getToolArgText(args: Record<string, unknown> | undefined, key: string) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function toolCommandPreview(block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]) {
  if (block.type !== "tool") return ""

  if (typeof block.args === "string" && block.args.trim()) {
    return block.args.trim()
  }

  const args = normalizeToolArgs(block.args)
  return (
    getToolArgText(args, "description") ||
    getToolArgText(args, "command") ||
    getToolArgText(args, "path") ||
    getToolArgText(args, "filePath")
  )
}

function toolReadLocation(block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]) {
  if (block.type !== "tool") return ""

  const args = normalizeToolArgs(block.args)
  const filePath = getToolArgText(args, "path") || getToolArgText(args, "filePath")
  const offset = args?.offset
  const limit = args?.limit

  if (typeof offset === "number" && typeof limit === "number" && limit > 0) {
    return `${filePath}:${offset}-${offset + limit - 1}`
  }
  if (typeof offset === "number") {
    return `${filePath}:${offset}`
  }
  if (typeof limit === "number" && limit > 0) {
    return `${filePath} limit=${limit}`.trim()
  }
  return filePath
}

function toolSummary(block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]) {
  if (block.type !== "tool") return ""
  const preview = block.name === "read" ? toolReadLocation(block) : toolCommandPreview(block)
  if (preview) return preview
  if (block.running) return "Running"
  if (block.isError) return "Failed"
  return "Done"
}

type ToolDiffLine = {
  type: "add" | "remove" | "context"
  lineNumber?: string
  text: string
}

function parseToolDiffLine(line: string): ToolDiffLine | null {
  if (!line) return null
  const match = line.match(/^([+\- ])(\s*\d*)\s(.*)$/)
  if (!match) {
    return { type: "context", text: line }
  }

  return {
    type: match[1] === "+" ? "add" : match[1] === "-" ? "remove" : "context",
    lineNumber: match[2] || undefined,
    text: match[3],
  }
}

function toolDiffPreview(block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]) {
  if (block.type !== "tool" || block.name !== "edit" || block.isError) return []
  const diff =
    block.details &&
    typeof block.details === "object" &&
    "diff" in block.details &&
    typeof block.details.diff === "string"
      ? block.details.diff
      : ""

  return diff
    .split("\n")
    .map(parseToolDiffLine)
    .filter((line): line is ToolDiffLine => Boolean(line))
}

function hideSuccessfulToolOutput(block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]) {
  return (
    block.type === "tool" &&
    !block.isError &&
    !block.running &&
    ["edit", "bash", "grep", "find", "ls"].includes(block.name || "")
  )
}

function compactionTriggerText(
  block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number]
) {
  if (block.type !== "compaction") return "Compaction"
  return block.tokensBefore > 0
    ? `Compaction: Compacted from ${block.tokensBefore.toLocaleString()} tokens`
    : "Compaction"
}

function ToolDiffPreview({ lines }: { lines: Array<ToolDiffLine> }) {
  const counts = new Map<string, number>()

  return (
    <pre className="overflow-x-auto rounded-lg border bg-background/80 p-3 text-xs leading-5">
      {lines.map((line) => {
        const baseKey = `${line.type}:${line.lineNumber || ""}:${line.text}`
        const count = (counts.get(baseKey) ?? 0) + 1
        counts.set(baseKey, count)

        return (
          <div
            key={`${baseKey}:${count}`}
            className={cn(
              "whitespace-pre-wrap font-mono",
              line.type === "add" && "text-emerald-700 dark:text-emerald-400",
              line.type === "remove" && "text-red-700 dark:text-red-400",
              line.type === "context" && "text-muted-foreground"
            )}
          >
            {line.lineNumber ? `${line.lineNumber} ` : ""}
            {line.text}
          </div>
        )
      })}
    </pre>
  )
}

function ToolBlockCard({
  block,
}: {
  block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number] & {
    type: "tool"
  }
}) {
  const diffLines = toolDiffPreview(block)
  const output = hideSuccessfulToolOutput(block) ? "" : block.output
  const hasContent = diffLines.length > 0 || Boolean(output)

  return (
    <details
      className={cn(
        "group rounded-xl border text-sm",
        block.running && "border-amber-500/30 bg-amber-500/5",
        block.isError && "border-destructive/30 bg-destructive/5",
        !block.running && !block.isError && "bg-muted/20"
      )}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex flex-1 items-start gap-2">
          <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <WrenchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {toolDisplayName(block.name)}
            </div>
            {toolSummary(block) ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {toolSummary(block)}
              </div>
            ) : null}
          </div>
        </div>
        {block.running ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner /> Running
          </span>
        ) : block.isError ? (
          <Badge variant="destructive">Error</Badge>
        ) : (
          <Badge variant="outline">Done</Badge>
        )}
      </summary>

      <div className="border-t px-3 py-3">
        {diffLines.length > 0 ? (
          <div className={cn(output && "mb-3")}>
            <ToolDiffPreview lines={diffLines} />
          </div>
        ) : null}

        {output ? (
          <pre className="overflow-x-auto rounded-lg border bg-background/80 p-3 text-xs leading-5 whitespace-pre-wrap">
            {output}
          </pre>
        ) : null}

        {!hasContent ? (
          <div className="text-xs text-muted-foreground">No output available.</div>
        ) : null}
      </div>
    </details>
  )
}

function CompactionBlockCard({
  block,
}: {
  block: Extract<ConversationItem, { kind: "assistant" }>['blocks'][number] & {
    type: "compaction"
  }
}) {
  return (
    <details className="rounded-xl border bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
        <ChevronRightIcon className="size-4 text-muted-foreground" />
        <span>{compactionTriggerText(block)}</span>
      </summary>
      <div className="mt-3 border-t pt-3">
        {block.summary.trim() ? (
          <MarkdownBlock text={block.summary} />
        ) : (
          <div className="text-sm text-muted-foreground">
            No compaction summary available.
          </div>
        )}
      </div>
    </details>
  )
}

export function MessagesWorkingIndicator({
  state,
}: {
  state: {
    label: string
    summary?: string
    done?: boolean
  }
}) {
  const visibleLabel = state.done ? "Done" : state.label

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full max-w-3xl items-start gap-3 rounded-xl px-1 py-1 text-sm",
        state.done ? "text-muted-foreground" : "text-muted-foreground"
      )}
    >
      <span className="mt-0.5 inline-flex items-center justify-center">
        {state.done ? (
          <CheckIcon className="size-4 text-emerald-600" />
        ) : (
          <Spinner />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{visibleLabel}</div>
        {state.summary ? (
          <div className="truncate text-muted-foreground">{state.summary}</div>
        ) : null}
      </div>
    </div>
  )
}

export function UserMessageCard({
  item,
}: {
  item: Extract<ConversationItem, { kind: "user" }>
}) {
  const labelText = userMessageLabel(item)

  return (
    <div className="ml-auto w-full max-w-3xl rounded-xl border bg-primary/6 px-4 py-3">
      {labelText ? (
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">{labelText}</Badge>
        </div>
      ) : null}
      {item.text ? (
        <div className="text-sm text-foreground">
          <MarkdownBlock text={item.text} />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Image prompt</div>
      )}
      {item.images.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-3">
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
    <div className="w-full max-w-3xl rounded-2xl border bg-card px-4 py-4">
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
                      className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                    >
                      {hiddenThinkingLabel || "Thinking hidden"}
                    </div>
                  )
                }

                return (
                  <section
                    key={key}
                    className="border-l-2 border-amber-500/45 pl-4 text-sm text-muted-foreground"
                  >
                    <MarkdownBlock text={block.text} />
                  </section>
                )
              case "tool":
                if (hideToolBlocks) {
                  return null
                }

                return <ToolBlockCard key={key} block={block} />
              case "compaction":
                return <CompactionBlockCard key={key} block={block} />
              default:
                return null
            }
          })
        })()}
      </div>
    </div>
  )
}
