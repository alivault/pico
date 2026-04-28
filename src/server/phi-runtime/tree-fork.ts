import type { TreeNode } from "@/lib/phi"
import type {
  MessageLike,
  SessionManagerLike,
  SessionTreeNodeLike,
} from "@/server/pi-sdk-types"

type ForkableSessionEntry = {
  session: {
    getUserMessagesForForking?: () =>
      | Array<{ entryId?: unknown; text?: unknown }>
      | undefined
    sessionManager: SessionManagerLike
  }
}

export function extractMessageText(message: MessageLike | undefined) {
  if (!message || typeof message !== "object") return ""

  const content = message.content
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""

  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim()
}

function extractSessionContentText(content: unknown) {
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""

  const text = content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join(" ")
    .trim()

  if (text) return text

  const imageCount = content.filter(
    (part) =>
      part &&
      typeof part === "object" &&
      ((part as { type?: unknown }).type === "image" ||
        (part as { type?: unknown }).type === "input_image")
  ).length

  if (imageCount > 0) {
    return `${imageCount} image${imageCount === 1 ? "" : "s"}`
  }

  return ""
}

function truncateTreeText(value: unknown, maxLength = 200) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}…`
}

function formatTreeToolCallPreview(
  name: string,
  args: Record<string, unknown>
) {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const shortenPath = (value: unknown) => {
    const text = typeof value === "string" ? value : ""
    if (!text) return ""
    return home && text.startsWith(home) ? `~${text.slice(home.length)}` : text
  }

  switch (name) {
    case "read": {
      const filePath = shortenPath(args.path || args.file_path)
      const offset = args.offset
      const limit = args.limit
      let display = filePath
      if (offset !== undefined || limit !== undefined) {
        const start = Number(offset ?? 1)
        const end = limit !== undefined ? start + Number(limit) - 1 : ""
        display += `:${start}${end ? `-${end}` : ""}`
      }
      return `[read: ${display}]`
    }
    case "write":
      return `[write: ${shortenPath(args.path || args.file_path)}]`
    case "edit":
      return `[edit: ${shortenPath(args.path || args.file_path)}]`
    case "bash": {
      const rawCommand = typeof args.command === "string" ? args.command : ""
      const command = rawCommand
        .replace(/[\n\t]/g, " ")
        .trim()
        .slice(0, 50)
      return `[bash: ${command}${rawCommand.length > 50 ? "..." : ""}]`
    }
    case "grep":
      return `[grep: /${
        typeof args.pattern === "string" ? args.pattern : ""
      }/ in ${shortenPath(args.path || ".")}]`
    case "find":
      return `[find: ${
        typeof args.pattern === "string" ? args.pattern : ""
      } in ${shortenPath(args.path || ".")}]`
    case "ls":
      return `[ls: ${shortenPath(args.path || ".")}]`
    default: {
      const serializedArgs = JSON.stringify(args)
      const preview = serializedArgs.slice(0, 40)
      return `[${name}: ${preview}${serializedArgs.length > 40 ? "..." : ""}]`
    }
  }
}

function serializeTreeMessageContent(content: unknown) {
  const text = truncateTreeText(extractSessionContentText(content))
  const toolCalls: Array<{ id?: string; name?: string; preview?: string }> = []

  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      if ((part as { type?: unknown }).type !== "toolCall") continue
      const toolName =
        typeof (part as { name?: unknown }).name === "string"
          ? (part as { name: string }).name
          : "tool"
      toolCalls.push({
        id:
          typeof (part as { id?: unknown }).id === "string"
            ? (part as { id: string }).id
            : undefined,
        name: toolName,
        preview: formatTreeToolCallPreview(
          toolName,
          typeof (part as { arguments?: unknown }).arguments === "object" &&
            (part as { arguments?: unknown }).arguments
            ? ((part as { arguments: Record<string, unknown> }).arguments ?? {})
            : {}
        ),
      })
    }
  }

  return {
    text,
    toolCalls,
  }
}

export function serializeSessionTreeNode(
  node: SessionTreeNodeLike
): TreeNode | null {
  if (!node?.entry || typeof node.entry !== "object") return null

  const entry = node.entry
  const serialized: TreeNode = {
    entry: {
      id: typeof entry.id === "string" ? entry.id : "",
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
      timestamp:
        typeof entry.timestamp === "string" ? entry.timestamp : undefined,
      type: typeof entry.type === "string" ? entry.type : "entry",
    },
    label:
      typeof node.label === "string" && node.label ? node.label : undefined,
    labelTimestamp:
      typeof node.labelTimestamp === "string" && node.labelTimestamp
        ? node.labelTimestamp
        : undefined,
    children: [],
  }

  if (entry.type === "message") {
    const message =
      typeof entry.message === "object" && entry.message
        ? (entry.message as MessageLike)
        : undefined
    const content = serializeTreeMessageContent(message?.content)

    serialized.entry.message = {
      role: typeof message?.role === "string" ? message.role : "message",
      text: content.text,
      toolCalls: content.toolCalls,
      stopReason:
        typeof message?.stopReason === "string"
          ? message.stopReason
          : undefined,
      errorMessage: truncateTreeText(message?.errorMessage),
      toolCallId:
        typeof message?.toolCallId === "string"
          ? message.toolCallId
          : undefined,
      toolName:
        typeof message?.toolName === "string" ? message.toolName : undefined,
      command: truncateTreeText(message?.command),
    }
  }

  if (entry.type === "custom_message") {
    serialized.entry.customType =
      typeof entry.customType === "string" ? entry.customType : "custom"
    serialized.entry.text = truncateTreeText(
      typeof entry.content === "string"
        ? entry.content
        : extractSessionContentText(entry.content)
    )
  }

  if (entry.type === "compaction") {
    serialized.entry.tokensBefore = Number(entry.tokensBefore) || 0
  }

  if (entry.type === "branch_summary") {
    serialized.entry.summary = truncateTreeText(entry.summary)
  }

  if (entry.type === "model_change") {
    serialized.entry.modelId =
      typeof entry.modelId === "string" ? entry.modelId : ""
  }

  if (entry.type === "thinking_level_change") {
    serialized.entry.thinkingLevel =
      typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : ""
  }

  if (entry.type === "custom") {
    serialized.entry.customType =
      typeof entry.customType === "string" ? entry.customType : "custom"
  }

  if (entry.type === "label") {
    serialized.entry.label =
      typeof entry.label === "string" ? entry.label : undefined
  }

  if (entry.type === "session_info") {
    serialized.entry.name = typeof entry.name === "string" ? entry.name : ""
  }

  serialized.children = (Array.isArray(node.children) ? node.children : [])
    .map((child) => serializeSessionTreeNode(child))
    .filter((child): child is TreeNode => Boolean(child))

  return serialized
}

export function extractForkableUserMessages(entry: ForkableSessionEntry) {
  const messages = entry.session.getUserMessagesForForking?.()
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((message) => ({
        entryId:
          typeof message.entryId === "string" ? message.entryId.trim() : "",
        text: typeof message.text === "string" ? message.text.trim() : "",
      }))
      .filter((message) => Boolean(message.entryId && message.text))
  }

  const manager = entry.session.sessionManager
  const tree = manager.getTree?.() ?? []
  const stack = [...tree]
  const results: Array<{ entryId: string; text: string }> = []
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    const message = node.entry.message
    if (node.entry.type === "message" && message?.role === "user") {
      const text = extractMessageText(message)
      if (typeof node.entry.id === "string" && text) {
        results.push({ entryId: node.entry.id, text })
      }
    }
    stack.push(...(Array.isArray(node.children) ? node.children : []))
  }
  return results.reverse()
}

export async function createForkedInMemorySessionManager(options: {
  sourceManager: SessionManagerLike
  leafId: string | null | undefined
  parentSession: string | undefined
  cloneSessionData: <T>(value: T) => T
  createInMemorySessionManager: (cwd: string) => SessionManagerLike
}) {
  const {
    sourceManager,
    leafId,
    parentSession,
    cloneSessionData,
    createInMemorySessionManager,
  } = options

  const nextManager = createInMemorySessionManager(sourceManager.getCwd())
  nextManager.newSession?.({ parentSession })

  if (!leafId) {
    return nextManager
  }

  const branchEntries = sourceManager.getBranch?.(leafId)
  if (!Array.isArray(branchEntries) || branchEntries.length === 0) {
    throw new Error(`Entry ${leafId} not found`)
  }

  const pathWithoutLabels = branchEntries
    .filter((branchEntry) => branchEntry?.type !== "label")
    .map((branchEntry) => cloneSessionData(branchEntry))
  const header = cloneSessionData(
    sourceManager.getHeader?.() ?? nextManager.fileEntries?.[0]
  )
  if (!header) {
    throw new Error("Failed to initialize forked in-memory session.")
  }

  nextManager.fileEntries = [header, ...pathWithoutLabels]
  nextManager.flushed = false
  nextManager._buildIndex?.()
  return nextManager
}
