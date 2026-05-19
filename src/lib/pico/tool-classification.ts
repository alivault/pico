export type ToolCategory = "explore"

const EXPLORE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "find",
  "ls",
  "list",
  "rg",
])
const EXPLORE_SHELL_COMMAND_NAMES = new Set(["find", "grep", "ls", "rg"])
const SKIPPABLE_SHELL_COMMAND_NAMES = new Set(["cd", "export", "pwd", "set"])
const SHELL_COMMAND_WRAPPER_NAMES = new Set([
  "command",
  "env",
  "noglob",
  "sudo",
  "time",
])

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

function getToolArgText(
  args: Record<string, unknown> | undefined,
  key: string
) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function toolCommandPreviewFromArgs(args: unknown) {
  if (typeof args === "string" && args.trim()) {
    return args.trim()
  }

  const normalizedArgs = normalizeToolArgs(args)
  return (
    getToolArgText(normalizedArgs, "description") ||
    getToolArgText(normalizedArgs, "command") ||
    getToolArgText(normalizedArgs, "path") ||
    getToolArgText(normalizedArgs, "filePath")
  )
}

function looksLikeJsonObjectPrefix(text: string) {
  return text === "{" || /^\{\s*(?:"|$)/.test(text)
}

export function toolArgsAreIncompleteJsonObject(args: unknown) {
  if (typeof args !== "string") return false

  const trimmed = args.trim()
  if (!looksLikeJsonObjectPrefix(trimmed)) return false

  try {
    JSON.parse(trimmed)
    return false
  } catch {
    return true
  }
}

function readPartialJsonStringValue(text: string, start: number) {
  let value = ""
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      switch (char) {
        case '"':
        case "\\":
        case "/":
          value += char
          break
        case "b":
          value += "\b"
          break
        case "f":
          value += "\f"
          break
        case "n":
          value += "\n"
          break
        case "r":
          value += "\r"
          break
        case "t":
          value += "\t"
          break
        case "u": {
          const hex = text.slice(index + 1, index + 5)
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(Number.parseInt(hex, 16))
            index += 4
          } else {
            value += char
          }
          break
        }
        default:
          value += char || ""
          break
      }
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === '"') break

    value += char || ""
  }

  return value.trim()
}

function partialJsonStringProperty(text: string, property: string) {
  const propertyPattern = new RegExp(
    `"${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`,
    "g"
  )
  const match = propertyPattern.exec(text)
  if (!match) return ""

  return readPartialJsonStringValue(text, match.index + match[0].length)
}

export function rawShellCommandTextFromTool(
  name: string | undefined,
  args: unknown
) {
  if (name !== "bash") return ""

  if (typeof args === "string") {
    const trimmed = args.trim()
    if (!trimmed) return ""

    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && "command" in parsed) {
        const command = (parsed as Record<string, unknown>).command
        return typeof command === "string" ? command.trim() : ""
      }
    } catch {
      if (toolArgsAreIncompleteJsonObject(trimmed)) {
        return partialJsonStringProperty(trimmed, "command")
      }

      return trimmed
    }

    return trimmed
  }

  const normalizedArgs = normalizeToolArgs(args)
  return (
    getToolArgText(normalizedArgs, "command") ||
    toolCommandPreviewFromArgs(args)
  )
}

function pathBaseName(path: string) {
  const normalized = path.replace(/\\/g, "/").trim()
  if (!normalized) return ""

  const parts = normalized.split("/")
  return parts[parts.length - 1] || normalized
}

function shellCommandNameFromSegment(segment: string) {
  let text = segment.trim()

  while (text) {
    const assignmentMatch = text.match(
      /^(?:env\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*/
    )
    if (assignmentMatch) {
      text = text.slice(assignmentMatch[0].length).trimStart()
      continue
    }

    const commandMatch = text.match(/^([./A-Za-z0-9_-]+)\b/)
    if (!commandMatch) return ""

    const commandPath = commandMatch[1] || ""
    const commandName = pathBaseName(commandPath)

    if (!SHELL_COMMAND_WRAPPER_NAMES.has(commandName)) {
      return commandName
    }

    text = text.slice(commandPath.length).trimStart()
  }

  return ""
}

export function exploreShellCommandNameFromTool(
  name: string | undefined,
  args: unknown
) {
  if (name !== "bash") return ""

  const command = rawShellCommandTextFromTool(name, args)
  const segments = command.split(/(?:&&|\|\||;)/)

  for (const segment of segments) {
    const commandName = shellCommandNameFromSegment(segment)
    if (!commandName || SKIPPABLE_SHELL_COMMAND_NAMES.has(commandName)) {
      continue
    }

    return EXPLORE_SHELL_COMMAND_NAMES.has(commandName) ? commandName : ""
  }

  return ""
}

export function toolCategoryFromTool(
  name: string | undefined,
  args: unknown
): ToolCategory | undefined {
  return EXPLORE_TOOL_NAMES.has(name || "") ||
    Boolean(exploreShellCommandNameFromTool(name, args))
    ? "explore"
    : undefined
}
