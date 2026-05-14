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

function rawShellCommandTextFromTool(name: string | undefined, args: unknown) {
  if (name !== "bash") return ""

  if (typeof args === "string") {
    const trimmed = args.trim()
    if (!trimmed) return ""

    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && "command" in parsed) {
        const command = (parsed as Record<string, unknown>).command
        return typeof command === "string" ? command.trim() : trimmed
      }
    } catch {
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

function exploreShellCommandNameFromTool(
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
