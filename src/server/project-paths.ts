import { readFile, readdir, realpath, stat } from "node:fs/promises"
import os from "node:os"
import path, { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import type { Dirent, Stats } from "node:fs"

const WALK_IGNORE_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".tanstack",
  "dist",
  "node_modules",
])
const PROJECT_FILE_TREE_LIMIT = 20_000
const PROJECT_FILE_READ_MAX_BYTES = 1_000_000

export type CompletionEntry = {
  value: string
  label: string
  description?: string
  isDirectory: boolean
}

export function displayPath(value = "") {
  return String(value).replace(/\\/g, "/")
}

export function expandHomeDirectory(inputPath: string) {
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/")) return `${os.homedir()}${inputPath.slice(1)}`
  return inputPath
}

export async function resolveDirectoryPath(inputPath: string, baseCwd: string) {
  const rawPath = typeof inputPath === "string" ? inputPath.trim() : ""
  if (!rawPath) {
    throw new Error("path is required")
  }

  const expandedPath = expandHomeDirectory(rawPath)
  const absolutePath = isAbsolute(expandedPath)
    ? expandedPath
    : resolve(baseCwd, expandedPath)

  let directoryStats: Stats
  try {
    directoryStats = await stat(absolutePath)
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") {
      throw new Error(`Directory not found: ${rawPath}`)
    }
    throw error
  }

  if (!directoryStats.isDirectory()) {
    throw new Error(`Not a directory: ${rawPath}`)
  }

  try {
    return await realpath(absolutePath)
  } catch {
    return absolutePath
  }
}

function buildCompletionValue(
  completionPath: string,
  {
    isAtPrefix = false,
    isQuotedPrefix = false,
  }: {
    isAtPrefix?: boolean
    isQuotedPrefix?: boolean
  } = {}
) {
  const normalizedPath = displayPath(completionPath)
  const needsQuotes = isQuotedPrefix || normalizedPath.includes(" ")
  const prefix = isAtPrefix ? "@" : ""

  if (!needsQuotes) {
    return `${prefix}${normalizedPath}`
  }

  return `${prefix}"${normalizedPath}"`
}

async function completionEntryIsDirectory(
  entry: Dirent<string>,
  fullPath: string
) {
  if (entry?.isDirectory()) return true
  if (!entry?.isSymbolicLink()) return false

  try {
    return (await stat(fullPath)).isDirectory()
  } catch {
    return false
  }
}

export async function listPathCompletionEntries(
  prefix: string,
  baseCwd: string
) {
  const rawPrefix = typeof prefix === "string" ? prefix : ""
  const displayPrefix = displayPath(rawPrefix)
  const expandedPrefix = expandHomeDirectory(rawPrefix)
  const isRootPrefix =
    rawPrefix === "" ||
    rawPrefix === "./" ||
    rawPrefix === "../" ||
    rawPrefix === "~" ||
    rawPrefix === "~/" ||
    rawPrefix === "/"

  let searchDir: string
  let searchPrefix: string

  if (isRootPrefix) {
    searchDir =
      rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")
        ? expandedPrefix || baseCwd
        : resolve(baseCwd, expandedPrefix)
    searchPrefix = ""
  } else if (rawPrefix.endsWith("/") || rawPrefix.endsWith("\\")) {
    searchDir =
      rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")
        ? expandedPrefix
        : resolve(baseCwd, expandedPrefix)
    searchPrefix = ""
  } else {
    const dir = dirname(expandedPrefix)
    searchDir =
      rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")
        ? dir
        : resolve(baseCwd, dir)
    searchPrefix = basename(expandedPrefix)
  }

  let entries: Array<Dirent<string>>
  try {
    entries = await readdir(searchDir, {
      withFileTypes: true,
      encoding: "utf8",
    })
  } catch {
    return []
  }

  const normalizedSearchPrefix = searchPrefix.toLowerCase()
  const suggestions: CompletionEntry[] = []

  for (const entry of entries) {
    if (!entry.name.toLowerCase().startsWith(normalizedSearchPrefix)) {
      continue
    }

    const fullPath = join(searchDir, entry.name)
    const isDirectory = await completionEntryIsDirectory(entry, fullPath)
    let completionPath: string

    if (displayPrefix.endsWith("/") || displayPrefix.endsWith("\\")) {
      completionPath = `${displayPrefix}${entry.name}`
    } else if (displayPrefix.includes("/") || displayPrefix.includes("\\")) {
      if (displayPrefix === "~") {
        completionPath = `~/${entry.name}`
      } else if (displayPrefix.startsWith("~/")) {
        const homeRelativeDir = displayPrefix.slice(2)
        const parentDir = dirname(homeRelativeDir)
        completionPath =
          parentDir === "."
            ? `~/${entry.name}`
            : `~/${displayPath(parentDir)}/${entry.name}`
      } else if (displayPrefix.startsWith("/")) {
        const parentDir = dirname(displayPrefix)
        completionPath =
          parentDir === "/"
            ? `/${entry.name}`
            : `${displayPath(parentDir)}/${entry.name}`
      } else {
        completionPath = displayPath(join(dirname(displayPrefix), entry.name))
        if (
          displayPrefix.startsWith("./") &&
          !completionPath.startsWith("./")
        ) {
          completionPath = `./${completionPath}`
        }
      }
    } else if (displayPrefix.startsWith("~")) {
      completionPath = `~/${entry.name}`
    } else {
      completionPath = entry.name
    }

    const value = isDirectory
      ? `${displayPath(completionPath)}/`
      : displayPath(completionPath)

    suggestions.push({
      value,
      label: `${entry.name}${isDirectory ? "/" : ""}`,
      isDirectory,
    })
  }

  suggestions.sort((left, right) => {
    if (left.isDirectory && !right.isDirectory) return -1
    if (!left.isDirectory && right.isDirectory) return 1
    return left.label.localeCompare(right.label)
  })

  return suggestions
}

function scoreFileReferenceEntry(
  filePath: string,
  query: string,
  isDirectory: boolean
) {
  if (!query) return 1

  const fileName = basename(filePath)
  const lowerFileName = fileName.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let score = 0

  if (lowerFileName === lowerQuery) score = 100
  else if (lowerFileName.startsWith(lowerQuery)) score = 80
  else if (lowerFileName.includes(lowerQuery)) score = 50
  else if (filePath.toLowerCase().includes(lowerQuery)) score = 30

  if (isDirectory && score > 0) {
    score += 10
  }

  return score
}

async function runFdSearch(command: string, args: string[]) {
  return await new Promise<
    Array<{ path: string; isDirectory: boolean }> | undefined
  >((resolveResult) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {
      resolveResult(undefined)
      return
    }

    let stdout = ""
    let resolved = false
    const finish = (
      value: Array<{ path: string; isDirectory: boolean }> | undefined
    ) => {
      if (resolved) return
      resolved = true
      resolveResult(value)
    }

    const childStdout = child.stdout
    if (!childStdout) {
      finish([])
      return
    }

    childStdout.setEncoding("utf8")
    childStdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(undefined)
        return
      }
      finish([])
    })
    child.on("close", (code) => {
      if (code !== 0 || !stdout) {
        finish([])
        return
      }

      const lines = stdout.trim().split("\n").filter(Boolean)
      const results: Array<{ path: string; isDirectory: boolean }> = []
      for (const line of lines) {
        const displayedLine = displayPath(line)
        const hasTrailingSeparator = displayedLine.endsWith("/")
        const normalizedPath = hasTrailingSeparator
          ? displayedLine.slice(0, -1)
          : displayedLine

        if (
          normalizedPath === ".git" ||
          normalizedPath.startsWith(".git/") ||
          normalizedPath.includes("/.git/")
        ) {
          continue
        }

        results.push({
          path: displayedLine,
          isDirectory: hasTrailingSeparator,
        })
      }

      finish(results)
    })
  })
}

function escapePathQueryRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildFdPathQuery(query = "") {
  const normalized = displayPath(query)
  if (!normalized.includes("/")) {
    return normalized
  }

  const hasTrailingSeparator = normalized.endsWith("/")
  const trimmed = normalized.replace(/^\/+|\/+$/g, "")
  if (!trimmed) {
    return normalized
  }

  const separatorPattern = "[\\\\/]"
  const segments = trimmed
    .split("/")
    .filter(Boolean)
    .map((segment) => escapePathQueryRegex(segment))

  if (segments.length === 0) {
    return normalized
  }

  let pattern = segments.join(separatorPattern)
  if (hasTrailingSeparator) {
    pattern += separatorPattern
  }
  return pattern
}

async function walkDirectoryWithFallback(
  baseDir: string,
  query = "",
  maxResults = 100
) {
  const queue = [baseDir]
  const matches: Array<{ path: string; isDirectory: boolean }> = []
  const normalizedQuery = displayPath(query).toLowerCase()

  while (queue.length > 0 && matches.length < maxResults) {
    const currentDir = queue.shift()
    if (!currentDir) continue

    let entries: Array<Dirent<string>>
    try {
      entries = await readdir(currentDir, {
        withFileTypes: true,
        encoding: "utf8",
      })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) break
      if (WALK_IGNORE_DIRECTORIES.has(entry.name)) continue

      const fullPath = join(currentDir, entry.name)
      const relativePath = displayPath(path.relative(baseDir, fullPath))
      const isDirectory = entry.isDirectory()
      const displayValue = isDirectory ? `${relativePath}/` : relativePath

      if (
        !normalizedQuery ||
        displayValue.toLowerCase().includes(normalizedQuery)
      ) {
        matches.push({
          path: displayValue,
          isDirectory,
        })
      }

      if (isDirectory) {
        queue.push(fullPath)
      }
    }
  }

  return matches
}

async function walkDirectory(baseDir: string, query = "", maxResults = 100) {
  const args = [
    "--base-directory",
    baseDir,
    "--max-results",
    String(maxResults),
    "--type",
    "f",
    "--type",
    "d",
    "--full-path",
    "--hidden",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**",
    "--exclude",
    ".next",
    "--exclude",
    ".output",
    "--exclude",
    ".tanstack",
    "--exclude",
    "dist",
    "--exclude",
    "node_modules",
  ]

  if (query) {
    args.push(buildFdPathQuery(query))
  }

  for (const command of ["fd", "fdfind"]) {
    const results = await runFdSearch(command, args)
    if (results !== undefined) {
      return results
    }
  }

  return await walkDirectoryWithFallback(baseDir, query, maxResults)
}

async function resolveScopedFileReferenceQuery(
  rawQuery: string,
  baseCwd: string
) {
  const normalizedQuery = displayPath(rawQuery)
  const slashIndex = normalizedQuery.lastIndexOf("/")
  if (slashIndex === -1) {
    return null
  }

  const displayBase = normalizedQuery.slice(0, slashIndex + 1)
  const query = normalizedQuery.slice(slashIndex + 1)

  let searchBaseDir: string
  if (displayBase.startsWith("~/")) {
    searchBaseDir = expandHomeDirectory(displayBase)
  } else if (displayBase.startsWith("/")) {
    searchBaseDir = displayBase
  } else {
    searchBaseDir = resolve(baseCwd, displayBase)
  }

  try {
    if (!(await stat(searchBaseDir)).isDirectory()) {
      return null
    }
  } catch {
    return null
  }

  return { searchBaseDir, query, displayBase }
}

function scopedDisplayPath(displayBase: string, relativePath: string) {
  const normalizedRelativePath = displayPath(relativePath)
  if (displayBase === "/") {
    return `/${normalizedRelativePath}`
  }
  return `${displayPath(displayBase)}${normalizedRelativePath}`
}

function normalizeProjectRelativePath(filePath: string) {
  const normalizedPath = displayPath(filePath).trim().replace(/^\.\//, "")
  if (!normalizedPath) throw new Error("file path is required")
  if (isAbsolute(normalizedPath)) throw new Error("file path must be relative")
  if (normalizedPath.split("/").some((part) => part === "..")) {
    throw new Error("file path must stay inside the directory")
  }
  return normalizedPath
}

function resolveProjectFilePath(baseCwd: string, filePath: string) {
  const normalizedPath = normalizeProjectRelativePath(filePath)
  const fullPath = resolve(baseCwd, normalizedPath)
  const relativePath = path.relative(baseCwd, fullPath)
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("file path must stay inside the directory")
  }
  return { fullPath, path: displayPath(relativePath) }
}

export async function listProjectFileTreePaths(baseCwd: string) {
  const entries = await walkDirectory(baseCwd, "", PROJECT_FILE_TREE_LIMIT)
  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => displayPath(entry.path).replace(/\/+$/g, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

export async function readProjectFileContent(
  baseCwd: string,
  filePath: string
) {
  const resolved = resolveProjectFilePath(baseCwd, filePath)
  const fileStats = await stat(resolved.fullPath)
  if (!fileStats.isFile()) throw new Error("Not a file")
  if (fileStats.size > PROJECT_FILE_READ_MAX_BYTES) {
    throw new Error("File is too large to preview")
  }

  const content = await readFile(resolved.fullPath, "utf8")
  if (content.includes("\u0000")) {
    throw new Error("Binary files cannot be previewed")
  }

  return {
    path: resolved.path,
    content,
  }
}

export async function listFileReferenceEntries(
  query: string,
  baseCwd: string,
  { isQuotedPrefix = false }: { isQuotedPrefix?: boolean } = {}
) {
  const normalizedQuery = typeof query === "string" ? query : ""
  const scopedQuery = await resolveScopedFileReferenceQuery(
    normalizedQuery,
    baseCwd
  )
  const searchBaseDir = scopedQuery?.searchBaseDir ?? baseCwd
  const searchQuery = scopedQuery?.query ?? normalizedQuery
  const entries = await walkDirectory(searchBaseDir, searchQuery, 100)

  return entries
    .map((entry) => ({
      ...entry,
      score: scoreFileReferenceEntry(
        entry.path,
        searchQuery,
        entry.isDirectory
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 20)
    .map((entry) => {
      const pathWithoutSlash = entry.isDirectory
        ? entry.path.slice(0, -1)
        : entry.path
      const displayValue = scopedQuery
        ? scopedDisplayPath(scopedQuery.displayBase, pathWithoutSlash)
        : pathWithoutSlash
      const completionPath = entry.isDirectory
        ? `${displayValue}/`
        : displayValue

      return {
        value: buildCompletionValue(completionPath, {
          isAtPrefix: true,
          isQuotedPrefix,
        }),
        label: `${basename(pathWithoutSlash)}${entry.isDirectory ? "/" : ""}`,
        description: displayValue,
        isDirectory: entry.isDirectory,
      }
    })
}
