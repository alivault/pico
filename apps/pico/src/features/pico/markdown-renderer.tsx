"use client"

import * as React from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { HighlightedCode } from "@/features/pico/highlighted-code"
import type { HighlightResponse } from "@/lib/pico/api"
import { hubUrl } from "@/lib/pico/machine"
import { cn } from "@/lib/utils"

const highlightCache = new Map<
  string,
  Promise<HighlightResponse> | HighlightResponse
>()

const MemoizedReactMarkdown = React.memo(ReactMarkdown)
type ReactMarkdownProps = React.ComponentProps<typeof ReactMarkdown>
// Links that open a desktop app, for example a note in Obsidian. The default
// schema removes them. Unsafe schemes such as javascript: stay blocked.
const APP_LINK_PROTOCOLS = ["obsidian", "vscode", "cursor", "zed", "file"]
const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), ...APP_LINK_PROTOCOLS],
  },
}
const APP_LINK_PATTERN = new RegExp(
  `^(?:${APP_LINK_PROTOCOLS.join("|")}):`,
  "i"
)

function markdownUrlTransform(url: string) {
  return APP_LINK_PATTERN.test(url) ? url : defaultUrlTransform(url)
}

const MARKDOWN_REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
] satisfies NonNullable<ReactMarkdownProps["rehypePlugins"]>
const MARKDOWN_REMARK_PLUGINS = [remarkGfm]
// User text keeps each line break, as typed in the prompt box.
const MARKDOWN_REMARK_PLUGINS_WITH_BREAKS = [remarkGfm, remarkBreaks]

type MarkdownFenceRange = {
  end: number
  start: number
}

type MarkdownRenderingContextValue = {
  completedFenceRanges?: Array<MarkdownFenceRange>
  streaming: boolean
}

const MarkdownRenderingContext =
  React.createContext<MarkdownRenderingContextValue>({
    streaming: false,
  })

type MarkdownAnchorProps = React.ComponentProps<"a"> & {
  node?: unknown
}

function MarkdownAnchor({
  children,
  href,
  node: _node,
  ...props
}: MarkdownAnchorProps) {
  return (
    <a
      href={href}
      onClick={(event) => handleMarkdownAnchorClick(event, href)}
      {...props}
    >
      {children}
    </a>
  )
}

type MarkdownCodeProps = React.ComponentProps<"code"> & {
  node?: unknown
}

function MarkdownCode({
  children,
  className,
  node: _node,
  ...props
}: MarkdownCodeProps) {
  return (
    <code
      className={cn(
        "rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-[var(--inline-code-foreground)] before:content-none after:content-none",
        className
      )}
      {...props}
    >
      {children}
    </code>
  )
}

type MarkdownPreProps = React.ComponentProps<"pre"> & {
  node?: unknown
}

function MarkdownPre({ children, node, ...props }: MarkdownPreProps) {
  const { completedFenceRanges, streaming } = React.use(
    MarkdownRenderingContext
  )
  const codeElement = getCodeBlockChild(children)

  if (!codeElement) {
    return <pre {...props}>{children}</pre>
  }

  const code = markdownNodeText(codeElement.props.children).replace(/\n$/, "")
  const language = parseCodeLanguage(codeElement.props.className)
  const codeBlockStreaming =
    streaming && !markdownNodeIsInFenceRange(node, completedFenceRanges)

  return (
    <CodeBlock code={code} language={language} streaming={codeBlockStreaming} />
  )
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownAnchor,
  code: MarkdownCode,
  pre: MarkdownPre,
} satisfies NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["components"]
>

function parseCodeLanguage(className?: string) {
  const match = className?.match(/language-([A-Za-z0-9_+#.-]+)/)
  return match?.[1]
}

function markdownTextContains(text: string, query: string) {
  return text.indexOf(query) >= 0
}

function collectCompleteFencedCodeRanges(markdown: string) {
  const ranges: Array<MarkdownFenceRange> = []
  let lineStart = 0
  let fence: {
    char: "`" | "~"
    length: number
    start: number
  } | null = null

  for (const rawLine of markdown.split("\n")) {
    const rawLineEnd = lineStart + rawLine.length
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

    if (!fence) {
      const opening = line.match(/^(?: {0,3})(`{3,}|~{3,})(.*)$/)
      if (opening) {
        const marker = opening[1]
        const char = marker[0] as "`" | "~"
        const info = opening[2] || ""

        if (char !== "`" || !markdownTextContains(info, "`")) {
          fence = {
            char,
            length: marker.length,
            start: lineStart,
          }
        }
      }
    } else {
      const closing = line.match(/^(?: {0,3})(`{3,}|~{3,})[ \t]*$/)
      const marker = closing?.[1]

      if (marker && marker[0] === fence.char && marker.length >= fence.length) {
        ranges.push({
          end: rawLineEnd,
          start: fence.start,
        })
        fence = null
      }
    }

    lineStart = rawLineEnd + 1
  }

  return ranges
}

function markdownNodePositionOffsets(node: unknown) {
  if (!node || typeof node !== "object") return null

  const position = (node as { position?: unknown }).position
  if (!position || typeof position !== "object") return null

  const start = (position as { start?: unknown }).start
  const end = (position as { end?: unknown }).end
  if (!start || typeof start !== "object" || !end || typeof end !== "object") {
    return null
  }

  const startOffset = (start as { offset?: unknown }).offset
  const endOffset = (end as { offset?: unknown }).offset
  if (typeof startOffset !== "number" || typeof endOffset !== "number") {
    return null
  }

  return { end: endOffset, start: startOffset }
}

function markdownNodeIsInFenceRange(
  node: unknown,
  ranges?: Array<MarkdownFenceRange>
) {
  if (!ranges?.length) return false

  const position = markdownNodePositionOffsets(node)
  if (!position) return false

  return ranges.some(
    (range) => position.start >= range.start && position.end <= range.end
  )
}

function handleMarkdownAnchorClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href?: string
) {
  if (!href?.startsWith("#user-content-fn")) return

  const targetId = decodeURIComponent(href.slice(1))
  const root = event.currentTarget.closest(".prose")
  const target = root?.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
  if (!target) return

  event.preventDefault()

  const scrollParent = getScrollParent(event.currentTarget)
  if (!scrollParent) {
    target.scrollIntoView({ block: "center" })
    return
  }

  const parentRect = scrollParent.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop =
    scrollParent.scrollTop +
    targetRect.top -
    parentRect.top -
    scrollParent.clientHeight / 3

  scrollParent.scrollTo({ top: Math.max(0, targetTop) })
}

function getScrollParent(element: HTMLElement) {
  let parent = element.parentElement

  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent)
    const overflowY = style.overflowY

    if (
      /(auto|scroll|overlay)/.test(overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent
    }

    parent = parent.parentElement
  }

  return null
}

function markdownNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => markdownNodeText(child)).join("")
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return markdownNodeText(node.props.children)
  }

  return ""
}

async function getHighlightedCode(code: string, language?: string) {
  if (!language) {
    return {
      ok: true,
      skipped: true,
    } satisfies HighlightResponse
  }

  const cacheKey = `${language}\u0000${code}`
  const cached = highlightCache.get(cacheKey)
  if (cached) {
    return await cached
  }

  // Highlighting is global data: it always goes to the hub.
  const promise = fetch(hubUrl("/api/highlight"), {
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

export async function copyTextToClipboard(text: string) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the textarea fallback below. The async clipboard API
      // can be denied even on secure origins.
    }
  }

  if (copyTextWithTextarea(text)) {
    return
  }

  throw new Error("Unable to copy text")
}

function copyTextWithTextarea(text: string) {
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  const selection = document.getSelection()
  const ranges: Range[] = []

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange())
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute("aria-hidden", "true")
  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  })

  document.body.append(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let copied = false
  try {
    copied = document.execCommand("copy")
  } finally {
    textarea.remove()

    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) {
        selection.addRange(range)
      }
    }

    activeElement?.focus({ preventScroll: true })
  }

  return copied
}

const CodeBlockCopyButton = React.memo(function CodeBlockCopyButton({
  code,
}: {
  code: string
}) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">(
    "idle"
  )

  const copyCode = async () => {
    try {
      await copyTextToClipboard(code)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1400)
    } catch {
      setCopyState("error")
      window.setTimeout(() => setCopyState("idle"), 1400)
    }
  }

  return (
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
  )
})

export const CodeBlock = React.memo(function CodeBlock({
  className,
  code,
  language,
  onPreScroll,
  preClassName,
  preRef,
  streaming = false,
}: {
  className?: string
  code: string
  language?: string
  onPreScroll?: React.UIEventHandler<HTMLPreElement>
  preClassName?: string
  preRef?: React.Ref<HTMLPreElement>
  streaming?: boolean
}) {
  const [highlightResult, setHighlightResult] = React.useState<{
    code: string
    language: string
    payload: HighlightResponse
  } | null>(null)

  React.useEffect(() => {
    if (!language || streaming) return

    let cancelled = false

    void getHighlightedCode(code, language)
      .then((payload) => {
        if (!cancelled) {
          setHighlightResult({ code, language, payload })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightResult({
            code,
            language,
            payload: { ok: true, unavailable: true },
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language, streaming])

  const highlighted =
    !streaming &&
    highlightResult?.code === code &&
    highlightResult.language === language
      ? highlightResult.payload
      : null
  const renderedLanguage =
    highlighted && "language" in highlighted && highlighted.language
      ? highlighted.language
      : language
  const displayedLanguage = language || renderedLanguage

  const highlightedHtml = hasHighlightHtml(highlighted)
    ? highlighted.html
    : null

  const highlightedContent = highlightedHtml ? (
    <HighlightedCode html={highlightedHtml} language={renderedLanguage} />
  ) : null

  return (
    <div
      className={cn(
        "not-prose overflow-hidden rounded-xl border bg-muted/40",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-background/80 px-3 py-2 text-xs text-muted-foreground">
        <div className="truncate font-medium tracking-wide uppercase">
          {displayedLanguage || "code"}
        </div>
        <CodeBlockCopyButton code={code} />
      </div>
      <pre
        ref={preRef}
        onScroll={onPreScroll}
        className={cn(
          "overflow-x-auto bg-transparent px-4 py-3 text-[13px] leading-6 text-foreground",
          preClassName
        )}
      >
        {highlightedContent || <code>{code}</code>}
      </pre>
    </div>
  )
})

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
  return Boolean(
    payload && !isHighlightSkipped(payload) && !isHighlightUnavailable(payload)
  )
}

function getCodeBlockChild(children: React.ReactNode) {
  const child = React.Children.toArray(children).find((node) =>
    React.isValidElement<{ children?: React.ReactNode; className?: string }>(
      node
    )
  )

  if (
    !React.isValidElement<{
      children?: React.ReactNode
      className?: string
    }>(child)
  ) {
    return null
  }

  return child
}

const LIST_ITEM_START = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
const HTML_BLOCK_OPEN = /^ {0,3}<([A-Za-z][\w-]*)(?=[\s>/]|$)/
const HTML_BLOCK_CLOSE = /^ {0,3}<\/([A-Za-z][\w-]*)\s*>/
const HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
])

/**
 * Split streaming markdown into chunks that each parse alone. A chunk ends
 * before a line that starts a new top-level block after a blank line, outside
 * code fences and HTML blocks. Lines that can continue a block (indented
 * lines and list items) do not start a chunk, so lists and code stay whole.
 * Only complete lines start a chunk, so the start of a chunk does not move
 * when more text arrives. The finished chunks keep the same text, so only the
 * last chunk parses again on each update.
 */
export function splitStreamingMarkdown(markdown: string) {
  const chunks: Array<string> = []
  const lines = markdown.split("\n")
  let chunkStart = 0
  let lineStart = 0
  let previousLineBlank = false
  let fence: { char: string; length: number } | null = null
  let htmlDepth = 0
  let inHtmlComment = false

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const lineComplete = index < lines.length - 1
    const blank = line.trim() === ""

    if (
      lineComplete &&
      previousLineBlank &&
      !blank &&
      !fence &&
      htmlDepth === 0 &&
      !inHtmlComment &&
      lineStart > chunkStart &&
      !/^[ \t]/.test(line) &&
      !LIST_ITEM_START.test(line)
    ) {
      chunks.push(markdown.slice(chunkStart, lineStart))
      chunkStart = lineStart
    }

    if (fence) {
      const closing = line.match(/^(?: {0,3})(`{3,}|~{3,})[ \t]*$/)
      const marker = closing?.[1]
      if (marker && marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
    } else if (inHtmlComment) {
      if (line.includes("-->")) inHtmlComment = false
    } else {
      const opening = line.match(/^(?: {0,3})(`{3,}|~{3,})(.*)$/)
      if (
        opening &&
        (opening[1][0] !== "`" || !markdownTextContains(opening[2] || "", "`"))
      ) {
        fence = { char: opening[1][0], length: opening[1].length }
      } else if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
        inHtmlComment = true
      } else if (HTML_BLOCK_CLOSE.test(line)) {
        htmlDepth = Math.max(0, htmlDepth - 1)
      } else {
        const tag = line.match(HTML_BLOCK_OPEN)?.[1]?.toLowerCase()
        if (
          tag &&
          !HTML_VOID_TAGS.has(tag) &&
          !line.trimEnd().endsWith("/>") &&
          !line.toLowerCase().includes(`</${tag}`)
        ) {
          htmlDepth += 1
        }
      }
    }

    previousLineBlank = blank
    lineStart += rawLine.length + 1
  }

  chunks.push(markdown.slice(chunkStart))
  return chunks
}

const MarkdownChunk = React.memo(function MarkdownChunk({
  breaks,
  streaming,
  text,
}: {
  breaks: boolean
  streaming: boolean
  text: string
}) {
  const renderingContext = {
    ...(streaming
      ? { completedFenceRanges: collectCompleteFencedCodeRanges(text) }
      : {}),
    streaming,
  } satisfies MarkdownRenderingContextValue

  return (
    <MarkdownRenderingContext value={renderingContext}>
      <MemoizedReactMarkdown
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={
          breaks ? MARKDOWN_REMARK_PLUGINS_WITH_BREAKS : MARKDOWN_REMARK_PLUGINS
        }
        components={MARKDOWN_COMPONENTS}
        urlTransform={markdownUrlTransform}
      >
        {text}
      </MemoizedReactMarkdown>
    </MarkdownRenderingContext>
  )
})

export const MarkdownBlock = React.memo(function MarkdownBlock({
  breaks = false,
  className,
  streaming = false,
  text,
}: {
  breaks?: boolean
  className?: string
  streaming?: boolean
  text: string
}) {
  // While text streams, parse only the last chunk again. When the stream
  // ends, parse the full text one time, so references and footnotes that
  // cross chunks resolve.
  const chunks = streaming ? splitStreamingMarkdown(text) : [text]

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none wrap-break-word dark:prose-invert prose-headings:font-semibold prose-p:my-2 prose-pre:m-0 prose-ol:my-2 prose-ul:my-2",
        className
      )}
    >
      {chunks.map((chunk, index) => (
        <MarkdownChunk
          key={index}
          breaks={breaks}
          streaming={streaming && index === chunks.length - 1}
          text={chunk}
        />
      ))}
    </div>
  )
})
