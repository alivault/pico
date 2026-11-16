/**
 * Project files for the workspace panel and the composer: directory lookup
 * and search, path and `@file` completions, the file tree, and file preview.
 */
import { createHash, randomBytes } from "node:crypto"
import type { Dirent } from "node:fs"
import {
  chmod,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path"

import { badRequest, conflict } from "../http.ts"

const TREE_LIMIT = 20_000
const READ_LIMIT = 1_000_000
const IMAGE_LIMIT = 50_000_000

/**
 * Images that the file viewer shows. SVG is text: the viewer reads it as
 * text, and can also show it as an image.
 */
const IMAGE_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

function imageType(path: string) {
  return IMAGE_TYPES[extname(path).toLowerCase()]
}
const SEARCH_DEPTH = 4
const SEARCH_LIMIT = 50
const FILE_COMPLETION_LIMIT = 20
const IGNORE_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".tanstack",
  "dist",
  "node_modules",
  "target",
])
const SEARCH_IGNORE_DIRECTORIES = new Set([
  ".cache",
  ".local",
  "Applications",
  "Library",
])

export type CompletionEntry = {
  value: string
  label: string
  description?: string
  isDirectory: boolean
}

function expandHome(path: string) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

const display = (path: string) => path.split(sep).join("/")

export async function resolveDirectory(input: string, baseCwd: string) {
  const trimmed = input.trim()
  if (!trimmed) throw badRequest("path is required")
  const expanded = expandHome(trimmed)
  const candidate = isAbsolute(expanded) ? expanded : join(baseCwd, expanded)
  let resolved: string
  try {
    resolved = await realpath(candidate)
  } catch {
    throw badRequest(`Directory not found: ${trimmed}`)
  }
  if (!(await stat(resolved)).isDirectory())
    throw badRequest(`Not a directory: ${trimmed}`)
  return resolved
}

async function entriesOf(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function pathCompletions(
  prefix: string,
  baseCwd: string
): Promise<CompletionEntry[]> {
  const normalized = prefix.replace(/\\/g, "/")
  const expanded = expandHome(prefix)
  const endsWithSeparator = /[/\\]$/.test(prefix)
  let directory: string
  let searchPrefix: string
  if (!prefix) {
    directory = baseCwd
    searchPrefix = ""
  } else if (endsWithSeparator) {
    directory = isAbsolute(expanded) ? expanded : join(baseCwd, expanded)
    searchPrefix = ""
  } else {
    const parent = dirname(expanded)
    directory = isAbsolute(expanded) ? parent : join(baseCwd, parent)
    searchPrefix = basename(expanded).toLowerCase()
  }
  const results: CompletionEntry[] = []
  for (const entry of await entriesOf(directory)) {
    if (!entry.name.toLowerCase().startsWith(searchPrefix)) continue
    let isDirectory = entry.isDirectory()
    if (!isDirectory && entry.isSymbolicLink()) {
      isDirectory = await stat(join(directory, entry.name)).then(
        (info) => info.isDirectory(),
        () => false
      )
    }
    let value: string
    if (endsWithSeparator) value = `${normalized}${entry.name}`
    else if (normalized.includes("/"))
      value = `${normalized.slice(0, normalized.lastIndexOf("/") + 1)}${entry.name}`
    else if (normalized === "~") value = `~/${entry.name}`
    else value = entry.name
    if (isDirectory) value += "/"
    results.push({
      value,
      label: `${entry.name}${isDirectory ? "/" : ""}`,
      isDirectory,
    })
  }
  results.sort((left, right) =>
    left.isDirectory === right.isDirectory
      ? left.label.toLowerCase().localeCompare(right.label.toLowerCase())
      : left.isDirectory
        ? -1
        : 1
  )
  return results
}

async function walk(root: string, limit: number, includeDirectories: boolean) {
  const queue = [root]
  const output: Array<{ path: string; isDirectory: boolean }> = []
  while (queue.length > 0) {
    const directory = queue.shift()!
    for (const entry of await entriesOf(directory)) {
      if (output.length >= limit) return output
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (IGNORE_DIRECTORIES.has(entry.name)) continue
        queue.push(path)
        if (includeDirectories) output.push({ path, isDirectory: true })
      } else if (entry.isFile()) {
        output.push({ path, isDirectory: false })
      }
    }
  }
  return output
}

function fileScore(path: string, query: string, isDirectory: boolean) {
  if (!query) return 1
  const lowerQuery = query.toLowerCase()
  const name = basename(path).toLowerCase()
  let score =
    name === lowerQuery
      ? 100
      : name.startsWith(lowerQuery)
        ? 80
        : name.includes(lowerQuery)
          ? 50
          : path.toLowerCase().includes(lowerQuery)
            ? 30
            : 0
  if (isDirectory && score > 0) score += 10
  return score
}

export async function fileCompletions(
  query: string,
  baseCwd: string,
  quoted: boolean
): Promise<CompletionEntry[]> {
  const normalized = query.replace(/\\/g, "/")
  let root = baseCwd
  let displayBase = ""
  let searchQuery = normalized
  const slash = normalized.lastIndexOf("/")
  if (slash >= 0) {
    displayBase = normalized.slice(0, slash + 1)
    searchQuery = normalized.slice(slash + 1)
    const expanded = expandHome(displayBase)
    root = isAbsolute(expanded) ? expanded : join(baseCwd, expanded)
  }
  try {
    root = await realpath(root)
    if (!(await stat(root)).isDirectory()) return []
  } catch {
    return []
  }
  const scored = (await walk(root, TREE_LIMIT, true))
    .map((entry) => {
      const path = display(relative(root, entry.path))
      return {
        path,
        isDirectory: entry.isDirectory,
        score: fileScore(path, searchQuery, entry.isDirectory),
      }
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.toLowerCase().localeCompare(right.path.toLowerCase())
    )
    .slice(0, FILE_COMPLETION_LIMIT)
  return scored.map(({ path, isDirectory }) => {
    const displayed = `${displayBase}${path}`
    const completion = `${displayed}${isDirectory ? "/" : ""}`
    const needsQuotes = quoted || completion.includes(" ")
    return {
      value: needsQuotes ? `@"${completion}"` : `@${completion}`,
      label: `${basename(path)}${isDirectory ? "/" : ""}`,
      description: displayed,
      isDirectory,
    }
  })
}

export async function projectTree(cwd: string) {
  const root = await realpath(cwd)
  return (await walk(root, TREE_LIMIT, false))
    .filter((entry) => !entry.isDirectory)
    .map((entry) => display(relative(root, entry.path)))
    .sort()
}

/** A version of the file content, so a save can see changes from others. */
const fileVersion = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

/**
 * A file of the project, from its path in `cwd`. An absolute path (or a
 * path from `~`) names a file outside the project, for example the global
 * AGENTS.md that an agent loads.
 */
async function resolveProjectFile(cwd: string, path: string) {
  const normalized = path.trim().replace(/^\.\//, "")
  if (!normalized) throw badRequest("file path is required")
  const expanded = expandHome(normalized)
  if (isAbsolute(expanded)) {
    let resolved: string
    try {
      resolved = await realpath(expanded)
    } catch {
      throw badRequest("File not found")
    }
    const info = await stat(resolved)
    if (!info.isFile()) throw badRequest("Not a file")
    return { normalized, resolved, info }
  }
  if (normalized.split(/[/\\]/).includes("..")) {
    throw badRequest("file path must stay inside the directory")
  }
  const root = await realpath(cwd)
  let resolved: string
  try {
    resolved = await realpath(join(root, normalized))
  } catch {
    throw badRequest("File not found")
  }
  if (resolved === root || !resolved.startsWith(`${root}${sep}`))
    throw badRequest("file path must stay inside the directory")
  const info = await stat(resolved)
  if (!info.isFile()) throw badRequest("Not a file")
  return { normalized, resolved, info }
}

export async function readProjectFile(cwd: string, path: string) {
  const { normalized, resolved, info } = await resolveProjectFile(cwd, path)
  const mimeType = imageType(normalized)
  if (mimeType && mimeType !== "image/svg+xml") {
    // The viewer loads the bytes from /api/files/raw; the version (from
    // the size and the time of change) makes its URL change with the file.
    if (info.size > IMAGE_LIMIT)
      throw badRequest("Image is too large to preview")
    return {
      path: display(normalized),
      content: "",
      version: `${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}`,
      image: { mimeType, size: info.size },
    }
  }
  if (info.size > READ_LIMIT) throw badRequest("File is too large to preview")
  const bytes = await readFile(resolved)
  if (bytes.includes(0)) throw badRequest("Binary files cannot be previewed")
  const content = new TextDecoder("utf-8", { fatal: true })
  try {
    return {
      path: display(normalized),
      content: content.decode(bytes),
      version: fileVersion(bytes),
    }
  } catch {
    throw badRequest("Binary files cannot be previewed")
  }
}

/** An image file of the project, for /api/files/raw. */
export async function projectImageFile(cwd: string, path: string) {
  const { resolved, info } = await resolveProjectFile(cwd, path)
  const mimeType = imageType(resolved)
  if (!mimeType) throw badRequest("Only images can be shown")
  if (info.size > IMAGE_LIMIT) throw badRequest("Image is too large to preview")
  return { resolved, size: info.size, mimeType }
}

// Where a project keeps its favicon, in the order to look. Web apps keep it
// in their public folder; Next.js apps keep it in their app folder.
const FAVICON_DIRECTORIES = [
  "",
  "public",
  "static",
  "app",
  "src/app",
  "src",
  "assets",
  "site",
  "web",
  "www",
]
const FAVICON_NAMES = [
  "favicon.svg",
  "icon.svg",
  "favicon.png",
  "icon.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "apple-icon.png",
]
// The folders of the apps and packages in a monorepo.
const FAVICON_WORKSPACE_DIRECTORIES = ["apps", "packages"]
const FAVICON_WORKSPACE_LIMIT = 20
const FAVICON_SIZE_LIMIT = 1_000_000
const FAVICON_CACHE_MS = 60_000

type ProjectFavicon = { path: string; version: string } | null

const faviconCache = new Map<
  string,
  { at: number; favicon: Promise<ProjectFavicon> }
>()

async function directoryNames(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

async function faviconIn(root: string, base: string): Promise<ProjectFavicon> {
  for (const directory of FAVICON_DIRECTORIES) {
    const relativeDirectory = join(base, directory)
    const entries = await directoryNames(join(root, relativeDirectory))
    const files = new Set(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    )
    for (const name of FAVICON_NAMES) {
      if (!files.has(name)) continue
      const path = join(relativeDirectory, name)
      const info = await stat(join(root, path)).catch(() => null)
      if (!info?.isFile() || info.size > FAVICON_SIZE_LIMIT) continue
      return {
        path: path.split(sep).join("/"),
        version: `${Math.round(info.mtimeMs)}-${info.size}`,
      }
    }
  }
  return null
}

async function findProjectFavicon(root: string): Promise<ProjectFavicon> {
  const own = await faviconIn(root, "")
  if (own) return own
  for (const workspace of FAVICON_WORKSPACE_DIRECTORIES) {
    const children = (await directoryNames(join(root, workspace)))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort()
      .slice(0, FAVICON_WORKSPACE_LIMIT)
    for (const child of children) {
      const favicon = await faviconIn(root, join(workspace, child))
      if (favicon) return favicon
    }
  }
  return null
}

/**
 * The favicon of a project, for its row in the sidebar: the path from the
 * project folder and a version that changes with the file. Null when the
 * project has none. The result stays for a minute.
 */
export async function projectFavicon(cwd: string) {
  const root = await realpath(cwd)
  const now = Date.now()
  const cached = faviconCache.get(root)
  if (cached && now - cached.at < FAVICON_CACHE_MS) return cached.favicon
  const favicon = findProjectFavicon(root)
  faviconCache.set(root, { at: now, favicon })
  return favicon
}

/**
 * Save a text file in the project. `version` is the version that the client
 * read. When the file changed after that read, the save stops with a conflict,
 * unless `version` is undefined (overwrite). The write goes to a temporary
 * file first and then replaces the file, so a failure cannot leave half a file.
 */
export async function writeProjectFile(
  cwd: string,
  path: string,
  content: string,
  version: string | undefined
) {
  const { normalized, resolved, info } = await resolveProjectFile(cwd, path)
  const bytes = Buffer.from(content, "utf8")
  if (bytes.length > READ_LIMIT) throw badRequest("File is too large to save")
  if (version !== undefined) {
    const current = await readFile(resolved)
    if (fileVersion(current) !== version)
      throw conflict("The file changed on disk after you opened it")
  }
  const temporary = join(
    dirname(resolved),
    `.${basename(resolved)}.${randomBytes(6).toString("hex")}.pico-tmp`
  )
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: info.mode & 0o7777 })
    await chmod(temporary, info.mode & 0o7777)
    await rename(temporary, resolved)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return { path: display(normalized), version: fileVersion(bytes) }
}

export async function searchDirectories(
  query: string,
  baseCwd: string
): Promise<CompletionEntry[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const home = homedir()
  const roots = [home]
  if (!baseCwd.startsWith(home)) roots.push(baseCwd)
  const seen = new Set<string>()
  const matches: Array<{ score: number; entry: CompletionEntry }> = []
  for (const root of roots) {
    const queue: Array<{ directory: string; depth: number }> = [
      { directory: root, depth: 0 },
    ]
    while (queue.length > 0) {
      const { directory, depth } = queue.shift()!
      if (depth >= SEARCH_DEPTH) continue
      for (const entry of await entriesOf(directory)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const name = entry.name
        if (IGNORE_DIRECTORIES.has(name) || SEARCH_IGNORE_DIRECTORIES.has(name))
          continue
        if (!needle.startsWith(".") && name.startsWith(".")) continue
        const path = join(directory, name)
        queue.push({ directory: path, depth: depth + 1 })
        const displayed = display(path)
        if (!displayed.toLowerCase().includes(needle) || seen.has(displayed))
          continue
        seen.add(displayed)
        const lowerName = name.toLowerCase()
        const score =
          (lowerName === needle
            ? 1000
            : lowerName.startsWith(needle)
              ? 800
              : lowerName.includes(needle)
                ? 600
                : 300) -
          depth * 5
        matches.push({
          score,
          entry: {
            value: displayed,
            label: `${name}/`,
            description: displayed,
            isDirectory: true,
          },
        })
      }
    }
  }
  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.value.localeCompare(right.entry.value)
    )
    .slice(0, SEARCH_LIMIT)
    .map(({ entry }) => entry)
}

export async function canonicalDirectory(path: string) {
  let resolved: string
  try {
    resolved = await realpath(expandHome(path))
  } catch (error) {
    throw badRequest(
      `invalid cwd ${path}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!(await stat(resolved)).isDirectory())
    throw badRequest("cwd must be a directory")
  return resolved
}
