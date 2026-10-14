/**
 * Project files for the workspace panel and the composer: directory lookup
 * and search, path and `@file` completions, the file tree, and file preview.
 */
import type { Dirent } from "node:fs"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

import { badRequest } from "../http.ts"

const TREE_LIMIT = 20_000
const READ_LIMIT = 1_000_000
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

export async function readProjectFile(cwd: string, path: string) {
  const normalized = path.trim().replace(/^\.\//, "")
  if (!normalized) throw badRequest("file path is required")
  if (isAbsolute(normalized) || normalized.split(/[/\\]/).includes("..")) {
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
  if (info.size > READ_LIMIT) throw badRequest("File is too large to preview")
  const bytes = await readFile(resolved)
  if (bytes.includes(0)) throw badRequest("Binary files cannot be previewed")
  const content = new TextDecoder("utf-8", { fatal: true })
  try {
    return { path: display(normalized), content: content.decode(bytes) }
  } catch {
    throw badRequest("Binary files cannot be previewed")
  }
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
