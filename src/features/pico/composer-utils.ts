import type { CompletionItem } from "@/lib/pico/api"

export type SlashCommandInput = {
  rawValue: string
  trimmedStart: string
  name: string
  args: string
  hasArguments: boolean
}

export type ParsedComposerSkillMessage = {
  matched: boolean
  skillName?: string
  text: string
}

export type PathCompletionQuery = {
  kind: "path"
  value: string
  selectionStart: number
  selectionEnd: number
  start: number
  end: number
  prefix: string
  rawPrefix: string
  isQuotedPrefix: boolean
  token: string
}

export type FileReferenceCompletionQuery = {
  kind: "file-reference"
  value: string
  selectionStart: number
  selectionEnd: number
  start: number
  end: number
  prefix: string
  rawPrefix: string
  isQuotedPrefix: boolean
  token: string
}

export type ComposerCompletionQuery =
  | PathCompletionQuery
  | FileReferenceCompletionQuery

export type SlashCommandDescriptor =
  | {
      kind: "builtin"
      name: string
      description?: string
    }
  | {
      kind: "skill"
      name: `skill:${string}`
      skillName: string
      description?: string
      scope?: string
      source?: string
    }

const PATH_COMPLETION_DELIMITERS = new Set([" ", "\t", "\n", '"', "'", "="])

export function parseComposerSkillMessage(
  value = ""
): ParsedComposerSkillMessage {
  const text = typeof value === "string" ? value : ""
  const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) {
    return { matched: false, skillName: undefined, text }
  }

  return {
    matched: true,
    skillName: match[1] || undefined,
    text: match[2] || "",
  }
}

export function serializeComposerDraft({
  text = "",
  skillName,
}: {
  text?: string
  skillName?: string
}) {
  const normalizedText = typeof text === "string" ? text : ""
  const normalizedSkillName =
    typeof skillName === "string" ? skillName.trim() : ""

  if (!normalizedSkillName) {
    return normalizedText
  }

  return normalizedText
    ? `/skill:${normalizedSkillName} ${normalizedText}`
    : `/skill:${normalizedSkillName}`
}

export function formatComposerSkillName(skillName = "") {
  return skillName
    .split(/[-_]+/)
    .flatMap((part) => {
      if (!part) return []
      if (part.length <= 3) return [part.toUpperCase()]
      return [`${part.charAt(0).toUpperCase()}${part.slice(1)}`]
    })
    .join(" ")
}

export function parseSlashCommandInput(value = ""): SlashCommandInput | null {
  const rawValue = typeof value === "string" ? value : ""
  const trimmedStart = rawValue.trimStart()
  if (!trimmedStart.startsWith("/")) return null

  const afterSlash = trimmedStart.slice(1)
  const whitespaceIndex = afterSlash.search(/\s/)
  const name =
    whitespaceIndex >= 0 ? afterSlash.slice(0, whitespaceIndex) : afterSlash
  const args =
    whitespaceIndex >= 0 ? afterSlash.slice(whitespaceIndex).trim() : ""

  return {
    rawValue,
    trimmedStart,
    name,
    args,
    hasArguments: whitespaceIndex >= 0,
  }
}

function normalizeSlashSearchValue(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function isSlashSubsequenceMatch(query: string, target: string) {
  if (!query) return true
  let queryIndex = 0
  for (const char of target) {
    if (char === query[queryIndex]) {
      queryIndex += 1
      if (queryIndex >= query.length) return true
    }
  }
  return false
}

function slashCommandSearchCandidates(command: SlashCommandDescriptor) {
  const candidates = [command.name, command.description || ""]
  if (command.kind === "skill") {
    candidates.push(
      command.skillName || "",
      `skill${command.skillName || ""}`,
      `skills ${command.skillName || ""}`,
      formatComposerSkillName(command.skillName || "")
    )
  }
  return candidates.filter(Boolean)
}

function slashCommandMatchRank(command: SlashCommandDescriptor, query: string) {
  const rawQuery = typeof query === "string" ? query.trim().toLowerCase() : ""
  if (!rawQuery) return command.kind === "builtin" ? 0 : 10

  const normalizedQuery = normalizeSlashSearchValue(rawQuery)
  let bestRank = Number.POSITIVE_INFINITY

  for (const candidate of slashCommandSearchCandidates(command)) {
    const rawCandidate = String(candidate).toLowerCase()
    const normalizedCandidate = normalizeSlashSearchValue(rawCandidate)

    if (rawCandidate === rawQuery) {
      bestRank = Math.min(bestRank, 0)
      continue
    }
    if (rawCandidate.startsWith(rawQuery)) {
      bestRank = Math.min(bestRank, 1)
      continue
    }
    if (normalizedQuery && normalizedCandidate.startsWith(normalizedQuery)) {
      bestRank = Math.min(bestRank, 2)
      continue
    }
    if (rawCandidate.includes(rawQuery)) {
      bestRank = Math.min(bestRank, 3)
      continue
    }
    if (normalizedQuery && normalizedCandidate.includes(normalizedQuery)) {
      bestRank = Math.min(bestRank, 4)
      continue
    }
    if (
      normalizedQuery &&
      isSlashSubsequenceMatch(normalizedQuery, normalizedCandidate)
    ) {
      bestRank = Math.min(bestRank, 5)
    }
  }

  return Number.isFinite(bestRank)
    ? bestRank + (command.kind === "builtin" ? 0 : 0.1)
    : Number.POSITIVE_INFINITY
}

export function matchingSlashCommands(
  commands: Array<SlashCommandDescriptor>,
  query: string
) {
  return commands
    .map((command) => ({
      command,
      rank: slashCommandMatchRank(command, query),
    }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.command.name.localeCompare(right.command.name)
    )
    .map((entry) => entry.command)
}

export function slashCommandQueryMatch(value = "") {
  const text = typeof value === "string" ? value : ""
  const match = text.match(/^(\s*)\/(\S*)(\s*)$/)
  if (!match) return null
  return {
    leadingWhitespace: match[1] || "",
  }
}

function findLastPathCompletionDelimiter(text = "") {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (PATH_COMPLETION_DELIMITERS.has(text[index] || "")) {
      return index
    }
  }
  return -1
}

function findNextPathCompletionDelimiter(text = "", start = 0) {
  for (let index = Math.max(0, start); index < text.length; index += 1) {
    if (PATH_COMPLETION_DELIMITERS.has(text[index] || "")) {
      return index
    }
  }
  return text.length
}

function findUnclosedCompletionQuoteStart(text = "") {
  let inQuotes = false
  let quoteStart = -1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      inQuotes = !inQuotes
      if (inQuotes) {
        quoteStart = index
      }
    }
  }
  return inQuotes ? quoteStart : null
}

function isCompletionTokenStart(text = "", index = 0) {
  return index === 0 || PATH_COMPLETION_DELIMITERS.has(text[index - 1] || "")
}

function extractQuotedCompletionPrefix(text = "") {
  const quoteStart = findUnclosedCompletionQuoteStart(text)
  if (quoteStart === null) return null

  if (quoteStart > 0 && text[quoteStart - 1] === "@") {
    if (!isCompletionTokenStart(text, quoteStart - 1)) {
      return null
    }
    return text.slice(quoteStart - 1)
  }

  if (!isCompletionTokenStart(text, quoteStart)) {
    return null
  }

  return text.slice(quoteStart)
}

function extractAtCompletionPrefix(text = "") {
  const quotedPrefix = extractQuotedCompletionPrefix(text)
  if (quotedPrefix?.startsWith('@"')) {
    return quotedPrefix
  }

  const lastDelimiterIndex = findLastPathCompletionDelimiter(text)
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1
  if (text[tokenStart] === "@") {
    return text.slice(tokenStart)
  }
  return null
}

function parseAtCompletionPrefix(prefix = "") {
  if (prefix.startsWith('@"')) {
    return { rawPrefix: prefix.slice(2), isQuotedPrefix: true }
  }
  if (prefix.startsWith("@")) {
    return { rawPrefix: prefix.slice(1), isQuotedPrefix: false }
  }
  return { rawPrefix: prefix, isQuotedPrefix: false }
}

function currentPromptLineBeforeCursor(value = "", cursor = 0) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1))
  return value.slice(lineStart + 1, cursor)
}

export function getPathCompletionQuery({
  value,
  selectionStart,
  selectionEnd,
  force = false,
}: {
  value: string
  selectionStart: number
  selectionEnd: number
  force?: boolean
}): PathCompletionQuery | null {
  if (selectionStart !== selectionEnd) return null

  const currentLine = currentPromptLineBeforeCursor(
    value,
    selectionStart
  ).trimStart()
  if (currentLine.startsWith("/") && !currentLine.includes(" ")) {
    return null
  }

  const textBeforeCursor = value.slice(0, selectionStart)
  const quotedPrefix = extractQuotedCompletionPrefix(textBeforeCursor)
  if (quotedPrefix && !quotedPrefix.startsWith("@")) {
    const rawPrefix = quotedPrefix.slice(1)
    if (!force && !rawPrefix) {
      return null
    }

    const start = selectionStart - quotedPrefix.length
    const afterCursor = value.slice(selectionStart)
    const closingQuoteIndex = afterCursor.indexOf('"')
    const end =
      closingQuoteIndex >= 0
        ? selectionStart + closingQuoteIndex + 1
        : selectionStart

    return {
      kind: "path",
      value,
      selectionStart,
      selectionEnd,
      start,
      end,
      prefix: quotedPrefix,
      rawPrefix,
      isQuotedPrefix: true,
      token: value.slice(start, end),
    }
  }

  const start = findLastPathCompletionDelimiter(textBeforeCursor) + 1
  const end = findNextPathCompletionDelimiter(value, selectionStart)
  const prefix = value.slice(start, selectionStart)

  if (!force) {
    const looksLikePath =
      prefix.includes("/") || prefix.startsWith(".") || prefix.startsWith("~")
    if (!looksLikePath) {
      return null
    }
  }

  return {
    kind: "path",
    value,
    selectionStart,
    selectionEnd,
    start,
    end,
    prefix,
    rawPrefix: prefix,
    isQuotedPrefix: false,
    token: value.slice(start, end),
  }
}

export function getFileReferenceCompletionQuery({
  value,
  selectionStart,
  selectionEnd,
}: {
  value: string
  selectionStart: number
  selectionEnd: number
}): FileReferenceCompletionQuery | null {
  if (selectionStart !== selectionEnd) return null

  const textBeforeCursor = value.slice(0, selectionStart)
  const prefix = extractAtCompletionPrefix(textBeforeCursor)
  if (!prefix) return null

  const start = selectionStart - prefix.length
  const afterCursor = value.slice(selectionStart)
  const end = prefix.startsWith('@"')
    ? (() => {
        const closingQuoteIndex = afterCursor.indexOf('"')
        return closingQuoteIndex >= 0
          ? selectionStart + closingQuoteIndex + 1
          : selectionStart
      })()
    : findNextPathCompletionDelimiter(value, selectionStart)
  const parsedPrefix = parseAtCompletionPrefix(prefix)

  return {
    kind: "file-reference",
    value,
    selectionStart,
    selectionEnd,
    start,
    end,
    prefix,
    rawPrefix: parsedPrefix.rawPrefix,
    isQuotedPrefix: parsedPrefix.isQuotedPrefix,
    token: value.slice(start, end),
  }
}

export function sameCompletionContext(
  left: ComposerCompletionQuery | null,
  right: ComposerCompletionQuery | null
) {
  if (!left || !right) return false
  return (
    left.kind === right.kind &&
    left.start === right.start &&
    left.end === right.end &&
    left.prefix === right.prefix
  )
}

function pathCompletionValue(item: CompletionItem, query: PathCompletionQuery) {
  const normalizedValue = item.value.replace(/\\/g, "/")
  const needsQuotes = query.isQuotedPrefix || normalizedValue.includes(" ")
  if (!needsQuotes || normalizedValue.startsWith('"')) {
    return normalizedValue
  }

  return `"${normalizedValue}"`
}

export function applyCompletionItem({
  value,
  query,
  item,
}: {
  value: string
  query: ComposerCompletionQuery
  item: CompletionItem
}) {
  const before = value.slice(0, query.start)
  const after = value.slice(query.end)
  const completionValue =
    query.kind === "path" ? pathCompletionValue(item, query) : item.value
  const suffix = query.kind === "file-reference" && !item.isDirectory ? " " : ""
  const nextValue = `${before}${completionValue}${suffix}${after}`
  const hasTrailingQuote = completionValue.endsWith('"')
  const cursorOffset =
    item.isDirectory && hasTrailingQuote
      ? completionValue.length - 1
      : completionValue.length
  const selection = before.length + cursorOffset + suffix.length

  return {
    value: nextValue,
    selectionStart: selection,
    selectionEnd: selection,
  }
}
