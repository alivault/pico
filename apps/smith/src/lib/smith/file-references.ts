/**
 * File paths in the conversation: in inline code, in links, and in the output
 * of tools. These functions find the text that can be a path. The server
 * then says which of them are files (`/api/files/exists`); only those become
 * links to the file viewer.
 */

export type FileReference = {
  path: string
  line?: number
  endLine?: number
}

const MAX_PATH_LENGTH = 400
/** Characters that a path in the conversation does not have. */
const NOT_IN_PATH = /[\s<>"'`|*?{}[\]()$;,=!&^]/
const EXTENSION = /\.[A-Za-z][A-Za-z0-9_-]{0,15}$/
// `:10`, `:10:5`, `:10-20`, `#L10`, `#L10-L20`, `#L10-20`, `#L10C5`.
const LINE_SUFFIX =
  /(?::(\d{1,7})(?::\d{1,5})?(?:-(\d{1,7}))?|#L(\d{1,7})(?:C\d{1,5})?(?:-L?(\d{1,7}))?)$/

function positiveNumber(text: string | undefined) {
  if (!text) return undefined
  const number = Number(text)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

/** Whether text looks like a path to a file: a folder or an extension. */
export function looksLikeFilePath(path: string) {
  if (!path || path.length > MAX_PATH_LENGTH) return false
  if (NOT_IN_PATH.test(path)) return false
  if (path.includes("://") || path.startsWith("-") || path.endsWith("/"))
    return false
  if (/^\.+$/.test(path) || path.includes("//")) return false
  const name = path.split("/").at(-1) ?? ""
  if (!name || /^\.+$/.test(name)) return false
  // A folder ("src/app.ts", "./a", "~/x") or a file with an extension.
  return path.includes("/") || EXTENSION.test(name)
}

/**
 * A file reference in text such as `src/app.ts`, `src/app.ts:10`,
 * `src/app.ts:10:5`, `src/app.ts:10-20`, or `src/app.ts#L10-L20`. Undefined
 * when the text cannot be a path.
 */
export function parseFileReference(text: string): FileReference | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_PATH_LENGTH + 20) return undefined
  const suffix = LINE_SUFFIX.exec(trimmed)
  const path = suffix ? trimmed.slice(0, suffix.index) : trimmed
  if (!looksLikeFilePath(path)) return undefined
  const line = positiveNumber(suffix?.[1] ?? suffix?.[3])
  const end = positiveNumber(suffix?.[2] ?? suffix?.[4])
  return {
    path,
    ...(line ? { line } : {}),
    ...(line && end && end > line ? { endLine: end } : {}),
  }
}

/**
 * A file reference in the target of a markdown link, as
 * `[app](src/app.ts#L10)`. Web links, app links, and page anchors are not.
 */
export function parseFileLinkHref(href: string | undefined) {
  if (!href || href.startsWith("#")) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    return undefined
  }
  return parseFileReference(decoded)
}

/** `path`, `path:10`, or `path:10-20`. */
export function formatFileReference(reference: FileReference) {
  if (!reference.line) return reference.path
  return reference.endLine
    ? `${reference.path}:${reference.line}-${reference.endLine}`
    : `${reference.path}:${reference.line}`
}

/** A part of tool output: text, or a path that may be a file. */
export type OutputSegment =
  | { text: string }
  | { text: string; reference: FileReference }

/** The most paths that one block of output links. */
export const OUTPUT_REFERENCE_LIMIT = 200

// grep and rg: `path:line:` and `path:line:col:` at the start of a line.
const GREP_LINE = /^([^\s:][^:\n]*?):(\d{1,7}):(?:\d{1,5}:)?/

function joinBase(base: string | undefined, path: string) {
  if (!base || path.startsWith("/") || path.startsWith("~/")) return path
  const trimmed = base.replace(/\/+$/, "")
  if (!trimmed || trimmed === ".") return path
  // grep on one file prints only its name.
  if (trimmed.split("/").at(-1) === path) return trimmed
  return `${trimmed}/${path}`
}

/**
 * Split tool output into text and paths: lines that start with `path:line:`
 * (grep, rg) and lines that are only a path (find, rg --files). `base` is
 * the folder that the paths are relative to, as the `path` argument of the
 * grep and find tools. At most `OUTPUT_REFERENCE_LIMIT` paths.
 */
export function splitOutputReferences(text: string, base?: string) {
  const segments: Array<OutputSegment> = []
  let count = 0
  let plain = ""
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : ""
    if (count < OUTPUT_REFERENCE_LIMIT) {
      const grep = GREP_LINE.exec(line)
      if (grep && looksLikeFilePath(grep[1]!)) {
        if (plain) segments.push({ text: plain })
        plain = ""
        count += 1
        segments.push({
          text: `${grep[1]}:${grep[2]}`,
          reference: {
            path: joinBase(base, grep[1]!),
            line: Number(grep[2]),
          },
        })
        plain = `${line.slice(grep[1]!.length + 1 + grep[2]!.length)}${newline}`
        return
      }
      const trimmed = line.trim()
      if (trimmed && trimmed === line && looksLikeFilePath(trimmed)) {
        if (plain) segments.push({ text: plain })
        plain = ""
        count += 1
        segments.push({
          text: trimmed,
          reference: { path: joinBase(base, trimmed) },
        })
        plain = newline
        return
      }
    }
    plain += `${line}${newline}`
  })
  if (plain) segments.push({ text: plain })
  return segments
}
