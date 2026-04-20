import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import http from "node:http"
import { readdir, realpath, stat, unlink } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"

import {
  STATIC_DIR,
  formatError,
  isLoopbackHost,
  loadPiSdk,
  makeSelfContainedSettingsManager,
  openBrowser,
  parseServeArgs,
  printUsage,
  readJsonBody,
  resolvePiSdkDir,
  sendJson,
  sendSseEvent,
  serveStatic,
  toClientUrl,
} from "./common.mjs"
import {
  cleanupSessionNameCandidate,
  deriveHeuristicSessionNameAttempt,
  generateSessionNameWithLlm,
  summarizePromptContent,
} from "./server/session-naming.mjs"
import { normalizeSessionScope, resolveScopeCwd } from "./server/scope.mjs"
import { createIdentityTheme, createUiState } from "./server/ui-state.mjs"

const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])
const BUILTIN_SLASH_COMMANDS = new Map([
  [
    "compact",
    {
      description: "Manually compact the session context",
      run: async (entry, args) => {
        await entry.session.compact(
          typeof args === "string" && args.trim() ? args.trim() : undefined
        )
      },
    },
  ],
])
const REPLAYABLE_SESSION_PAYLOAD_TYPES = new Set([
  "agent_start",
  "agent_end",
  "auto_retry_end",
  "auto_retry_start",
  "compaction_end",
  "compaction_start",
  "context_usage",
  "message_end",
  "message_start",
  "message_update",
  "model_select",
  "queue_update",
  "request_error",
  "session_meta",
  "state_sync",
  "tool_execution_end",
  "tool_execution_start",
  "tool_execution_update",
  "turn_end",
  "turn_start",
  "ui_editor_text",
  "ui_hidden_thinking_label",
  "ui_status",
  "ui_title",
  "ui_working_message",
  "user_message",
])
const REPLAY_RUN_RECENT_TTL_MS = 30_000

export async function runServe(
  argv,
  { openBrowser: defaultOpenBrowser = false } = {}
) {
  const options = parseServeArgs(argv, { openBrowser: defaultOpenBrowser })
  if (options.help) {
    printUsage()
    return
  }

  const sdk = await loadPiSdk()
  const identityTheme = createIdentityTheme()
  const agentDir = sdk.getAgentDir()
  const servicesByCwd = new Map()
  const sessionEntries = new Map()
  const contexts = new Map()
  const pendingUiRequests = new Map()
  const highlightCache = new Map()
  const gitStatusCache = new Map()
  const gitChangesCache = new Map()
  const gitLiveDirectoryStates = new Map()
  const GIT_STATUS_CACHE_TTL_MS = 5_000
  const GIT_CHANGES_CACHE_TTL_MS = 5_000
  const GIT_COMMITS_LIMIT = 60
  const GIT_LIVE_POLL_INTERVAL_MS = 1_500
  let server
  let heartbeat
  let gitLivePoller
  let gitLiveRefreshScheduled = false
  let shuttingDown = false
  let highlightJs
  let highlightLoadErrorLogged = false

  function normalizeHighlightLanguage(language) {
    const normalized =
      typeof language === "string"
        ? language
            .trim()
            .toLowerCase()
            .replace(/^language-/, "")
        : ""
    if (!normalized) return ""

    switch (normalized) {
      case "shellscript":
        return "bash"
      case "plain":
      case "text":
        return "plaintext"
      case "c++":
        return "cpp"
      case "c#":
        return "csharp"
      case "objective-c":
        return "objectivec"
      default:
        return normalized
    }
  }

  function countTextLines(text) {
    let lines = 1
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) === 10) {
        lines += 1
      }
    }
    return lines
  }

  function getHighlightJs() {
    if (highlightJs) return highlightJs
    const require = createRequire(import.meta.url)
    highlightJs = require(
      resolve(resolvePiSdkDir(), "node_modules", "highlight.js")
    )
    return highlightJs
  }

  function highlightCacheKey(language, code) {
    const hash = createHash("sha1")
    hash.update(language)
    hash.update("\0")
    hash.update(code)
    return hash.digest("hex")
  }

  function setHighlightCache(key, value) {
    highlightCache.set(key, value)
    if (highlightCache.size > 200) {
      const oldestKey = highlightCache.keys().next().value
      if (oldestKey) {
        highlightCache.delete(oldestKey)
      }
    }
    return value
  }

  function highlightCodePayload(code, language) {
    const text = typeof code === "string" ? code : ""
    const normalizedLanguage = normalizeHighlightLanguage(language)

    if (!text || !normalizedLanguage) {
      return { skipped: true, language: normalizedLanguage || undefined }
    }

    if (
      normalizedLanguage === "plaintext" ||
      text.length > 100_000 ||
      countTextLines(text) > 1_500
    ) {
      return { skipped: true, language: normalizedLanguage }
    }

    const cacheKey = highlightCacheKey(normalizedLanguage, text)
    const cached = highlightCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const hljs = getHighlightJs()
    const supportedLanguage =
      typeof hljs.getLanguage === "function"
        ? hljs.getLanguage(normalizedLanguage)
        : null
    if (!supportedLanguage) {
      return setHighlightCache(cacheKey, {
        unsupported: true,
        language: normalizedLanguage,
      })
    }

    const result = hljs.highlight(text, {
      language: normalizedLanguage,
      ignoreIllegals: true,
    })
    return setHighlightCache(cacheKey, {
      language: result?.language || normalizedLanguage,
      html: result?.value || "",
    })
  }

  async function getServicesForCwd(cwd) {
    let cached = servicesByCwd.get(cwd)
    if (cached) return cached

    const settingsManager = makeSelfContainedSettingsManager(
      sdk.SettingsManager.create(cwd, agentDir)
    )
    cached = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
      },
    })
    if (cached.diagnostics.length > 0) {
      for (const diagnostic of cached.diagnostics) {
        const prefix =
          diagnostic.type === "error"
            ? "error"
            : diagnostic.type === "warning"
              ? "warn"
              : "info"
        console.log(`[pi-web:${prefix}] ${diagnostic.message}`)
      }
    }
    servicesByCwd.set(cwd, cached)
    return cached
  }

  async function runCommand(command, args, { cwd, timeoutMs = 2_000 } = {}) {
    return await new Promise((resolve) => {
      let child
      try {
        child = spawn(command, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch (error) {
        resolve({ code: undefined, stdout: "", stderr: "", error })
        return
      }

      let stdout = ""
      let stderr = ""
      let finished = false
      let timeoutId

      const finish = (value) => {
        if (finished) return
        finished = true
        if (timeoutId) clearTimeout(timeoutId)
        resolve(value)
      }

      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (chunk) => {
        stdout += chunk
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk
      })
      child.on("error", (error) => {
        finish({ code: undefined, stdout, stderr, error })
      })
      child.on("close", (code) => {
        finish({ code, stdout, stderr })
      })

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGTERM")
          finish({ code: undefined, stdout, stderr, timedOut: true })
        }, timeoutMs)
      }
    })
  }

  function formatDirectoryGitStatus(value) {
    if (!value) return null

    const dirty = Boolean(value.dirty)
    const ahead =
      Number.isInteger(value.ahead) && value.ahead > 0 ? value.ahead : 0
    const behind =
      Number.isInteger(value.behind) && value.behind > 0 ? value.behind : 0

    if (value.detached) {
      const revision =
        typeof value.revision === "string" ? value.revision.trim() : ""
      const inline = ["detached", revision || undefined]
        .filter(Boolean)
        .join(" ")
      const label = revision ? `Detached HEAD (${revision})` : "Detached HEAD"
      const titleParts = [label]
      if (dirty) titleParts.push("modified")
      if (ahead > 0) titleParts.push(`ahead ${ahead}`)
      if (behind > 0) titleParts.push(`behind ${behind}`)
      return {
        branch: undefined,
        detached: true,
        revision: revision || undefined,
        dirty,
        ahead,
        behind,
        inline,
        label,
        title: titleParts.join(" · "),
      }
    }

    const branch = typeof value.branch === "string" ? value.branch.trim() : ""
    if (!branch) return null

    const label = `Main branch (${branch})`
    const inlineParts = [branch]
    if (dirty) inlineParts.push("*")
    if (ahead > 0) inlineParts.push(`↑${ahead}`)
    if (behind > 0) inlineParts.push(`↓${behind}`)
    const titleParts = [label]
    if (dirty) titleParts.push("modified")
    if (ahead > 0) titleParts.push(`ahead ${ahead}`)
    if (behind > 0) titleParts.push(`behind ${behind}`)
    return {
      branch,
      detached: false,
      revision:
        typeof value.revision === "string" && value.revision.trim()
          ? value.revision.trim()
          : undefined,
      dirty,
      ahead,
      behind,
      inline: inlineParts.join(" "),
      label,
      title: titleParts.join(" · "),
    }
  }

  async function readDirectoryGitStatus(cwd, { force = false } = {}) {
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
    if (!normalizedCwd) return null

    if (force) {
      gitStatusCache.delete(normalizedCwd)
    }

    const cached = gitStatusCache.get(normalizedCwd)
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const insideWorkTree = await runCommand(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    )
    if (insideWorkTree.code !== 0 || insideWorkTree.stdout.trim() !== "true") {
      gitStatusCache.set(normalizedCwd, {
        value: null,
        expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
      })
      return null
    }

    const [branchResult, revisionResult, dirtyResult, upstreamResult] =
      await Promise.all([
        runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }),
        runCommand("git", ["rev-parse", "--short", "HEAD"], {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }),
        runCommand("git", ["status", "--porcelain"], {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }),
        runCommand(
          "git",
          ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
          {
            cwd: normalizedCwd,
            timeoutMs: 1_500,
          }
        ),
      ])

    const upstreamCounts =
      typeof upstreamResult.stdout === "string"
        ? upstreamResult.stdout.trim().split(/\s+/)
        : []
    const ahead =
      upstreamResult.code === 0
        ? Number.parseInt(upstreamCounts[0] || "0", 10) || 0
        : 0
    const behind =
      upstreamResult.code === 0
        ? Number.parseInt(upstreamCounts[1] || "0", 10) || 0
        : 0

    const value = formatDirectoryGitStatus({
      branch: branchResult.code === 0 ? branchResult.stdout : "",
      detached: branchResult.code !== 0,
      revision: revisionResult.code === 0 ? revisionResult.stdout : "",
      dirty: dirtyResult.code === 0 && Boolean(dirtyResult.stdout.trim()),
      ahead,
      behind,
    })

    gitStatusCache.set(normalizedCwd, {
      value,
      expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
    })
    return value
  }

  function parseCommandNullList(output) {
    return typeof output === "string"
      ? output
          .split("\u0000")
          .filter((entry) => typeof entry === "string" && entry.length > 0)
      : []
  }

  function parseCommandLines(output, { trim = false } = {}) {
    if (typeof output !== "string") return []
    return output
      .split(/\r?\n/)
      .map((entry) => (trim ? entry.trim() : entry))
      .filter((entry) => Boolean(trim ? entry : entry.length))
  }

  function parseGitStatusEntries(output) {
    const entries = parseCommandNullList(output)
    const files = []

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      if (typeof entry !== "string" || entry.length < 3) continue

      const status = entry.slice(0, 2)
      let path = entry.slice(3)
      let previousPath
      if (
        (status.startsWith("R") || status.startsWith("C")) &&
        typeof entries[index + 1] === "string"
      ) {
        previousPath = entries[index + 1]
        index += 1
      }

      files.push({
        status,
        path,
        previousPath,
      })
    }

    return files
  }

  function parseGitNumstatEntries(output) {
    const entries = parseCommandNullList(output)
    const diffs = new Map()

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      if (typeof entry !== "string" || !entry.includes("\t")) continue

      const [addedRaw = "", deletedRaw = "", ...pathParts] = entry.split("\t")
      let path = pathParts.join("\t")
      let previousPath
      if (!path) {
        previousPath =
          typeof entries[index + 1] === "string"
            ? entries[index + 1]
            : undefined
        path = typeof entries[index + 2] === "string" ? entries[index + 2] : ""
        if (path) {
          index += 2
        }
      }
      if (!path) continue

      const parsedAdded = Number.parseInt(addedRaw, 10)
      const parsedDeleted = Number.parseInt(deletedRaw, 10)
      diffs.set(path, {
        previousPath,
        linesAdded: Number.isFinite(parsedAdded) ? parsedAdded : undefined,
        linesDeleted: Number.isFinite(parsedDeleted)
          ? parsedDeleted
          : undefined,
      })
    }

    return diffs
  }

  function parseGitRefRows(output) {
    return parseCommandLines(output)
      .map((line) => line.split("\u0000"))
      .filter(
        (fields) =>
          fields.length > 0 &&
          fields.some((field) => typeof field === "string" && field.length > 0)
      )
  }

  function parseGitBranchTrack(track, upstream) {
    const trackValue = typeof track === "string" ? track.trim() : ""
    const hasUpstream =
      typeof upstream === "string" && upstream.trim().length > 0
    if (!hasUpstream) {
      return {
        ahead: 0,
        behind: 0,
        upstreamGone: false,
      }
    }
    if (trackValue === "[gone]") {
      return {
        ahead: 0,
        behind: 0,
        upstreamGone: true,
      }
    }
    const aheadMatch = trackValue.match(/ahead\s+(\d+)/i)
    const behindMatch = trackValue.match(/behind\s+(\d+)/i)
    return {
      ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) || 0 : 0,
      behind: behindMatch ? Number.parseInt(behindMatch[1], 10) || 0 : 0,
      upstreamGone: false,
    }
  }

  function parseGitLocalBranches(output) {
    const branches = []
    for (const fields of parseGitRefRows(output)) {
      const [
        headMarker = "",
        name = "",
        upstream = "",
        track = "",
        hash = "",
        subject = "",
        relativeDate = "",
      ] = fields
      const branchName = typeof name === "string" ? name.trim() : ""
      if (!branchName) continue
      const trackInfo = parseGitBranchTrack(track, upstream)
      branches.push({
        name: branchName,
        current: headMarker.trim() === "*",
        upstream:
          typeof upstream === "string" && upstream.trim()
            ? upstream.trim()
            : undefined,
        ahead: trackInfo.ahead,
        behind: trackInfo.behind,
        upstreamGone: trackInfo.upstreamGone,
        hash: typeof hash === "string" && hash.trim() ? hash.trim() : undefined,
        subject:
          typeof subject === "string" && subject.trim()
            ? subject.trim()
            : undefined,
        relativeDate:
          typeof relativeDate === "string" && relativeDate.trim()
            ? relativeDate.trim()
            : undefined,
      })
    }

    branches.sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    return branches
  }

  function parseGitRemoteBranches(output) {
    const branches = []
    for (const fields of parseGitRefRows(output)) {
      const [name = "", hash = "", subject = "", relativeDate = ""] = fields
      const branchName = typeof name === "string" ? name.trim() : ""
      if (
        !branchName ||
        !branchName.includes("/") ||
        /\/HEAD$/i.test(branchName)
      )
        continue
      branches.push({
        name: branchName,
        hash: typeof hash === "string" && hash.trim() ? hash.trim() : undefined,
        subject:
          typeof subject === "string" && subject.trim()
            ? subject.trim()
            : undefined,
        relativeDate:
          typeof relativeDate === "string" && relativeDate.trim()
            ? relativeDate.trim()
            : undefined,
      })
    }
    return branches
  }

  async function readDirectoryGitChanges(cwd, { force = false } = {}) {
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
    if (!normalizedCwd) return null

    if (force) {
      gitChangesCache.delete(normalizedCwd)
    }

    const cached = gitChangesCache.get(normalizedCwd)
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const insideWorkTree = await runCommand(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }
    )
    if (insideWorkTree.code !== 0 || insideWorkTree.stdout.trim() !== "true") {
      gitChangesCache.set(normalizedCwd, {
        value: null,
        expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
      })
      return null
    }

    const [
      statusResult,
      numstatResult,
      localBranchesResult,
      remoteBranchesResult,
      commitsResult,
      unpushedResult,
    ] = await Promise.all([
      runCommand(
        "git",
        [
          "status",
          "--porcelain",
          "-z",
          "--find-renames=50%",
          "--untracked-files=all",
        ],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
      runCommand("git", ["diff", "--numstat", "-z", "HEAD"], {
        cwd: normalizedCwd,
        timeoutMs: 1_500,
      }),
      runCommand(
        "git",
        [
          "for-each-ref",
          "--sort=-committerdate",
          "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)",
          "refs/heads",
        ],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
      runCommand(
        "git",
        [
          "for-each-ref",
          "--sort=-committerdate",
          "--format=%(refname:short)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)",
          "refs/remotes",
        ],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
      runCommand(
        "git",
        [
          "log",
          "--graph",
          "--pretty=format:%h%x09%s",
          "--abbrev-commit",
          "--date-order",
          "-n",
          String(GIT_COMMITS_LIMIT),
          "--no-color",
          "HEAD",
        ],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
      runCommand(
        "git",
        ["rev-list", "--abbrev-commit", "--abbrev=7", "@{upstream}..HEAD"],
        {
          cwd: normalizedCwd,
          timeoutMs: 1_500,
        }
      ),
    ])

    const numstatByPath =
      numstatResult.code === 0
        ? parseGitNumstatEntries(numstatResult.stdout)
        : new Map()
    const files =
      statusResult.code === 0
        ? parseGitStatusEntries(statusResult.stdout).map((file) => {
            const diff = numstatByPath.get(file.path)
            if (!diff) {
              return file
            }
            return {
              ...file,
              linesAdded: diff.linesAdded,
              linesDeleted: diff.linesDeleted,
            }
          })
        : []
    const localBranches =
      localBranchesResult.code === 0
        ? parseGitLocalBranches(localBranchesResult.stdout)
        : []
    const remoteBranches =
      remoteBranchesResult.code === 0
        ? parseGitRemoteBranches(remoteBranchesResult.stdout)
        : []
    const commits =
      commitsResult.code === 0 ? parseCommandLines(commitsResult.stdout) : []
    const unpushedCommitShortHashes =
      unpushedResult.code === 0
        ? parseCommandLines(unpushedResult.stdout, { trim: true })
        : []
    const value = {
      files,
      localBranches,
      remoteBranches,
      commits,
      unpushedCommitShortHashes,
    }

    gitChangesCache.set(normalizedCwd, {
      value,
      expiresAt: Date.now() + GIT_CHANGES_CACHE_TTL_MS,
    })
    return value
  }

  function expandHomeDirectory(inputPath) {
    if (inputPath === "~") return homedir()
    if (inputPath.startsWith("~/")) return `${homedir()}${inputPath.slice(1)}`
    return inputPath
  }

  async function resolveDirectoryPath(inputPath, baseCwd) {
    const rawPath = typeof inputPath === "string" ? inputPath.trim() : ""
    if (!rawPath) {
      throw new Error("path is required")
    }

    const expandedPath = expandHomeDirectory(rawPath)
    const absolutePath = isAbsolute(expandedPath)
      ? expandedPath
      : resolve(baseCwd, expandedPath)
    let directoryStats
    try {
      directoryStats = await stat(absolutePath)
    } catch (error) {
      if (error?.code === "ENOENT") {
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

  function displayPath(value = "") {
    return String(value).replace(/\\/g, "/")
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

  function buildCompletionValue(
    path,
    { isAtPrefix = false, isQuotedPrefix = false } = {}
  ) {
    const normalizedPath = displayPath(path)
    const needsQuotes = isQuotedPrefix || normalizedPath.includes(" ")
    const prefix = isAtPrefix ? "@" : ""
    if (!needsQuotes) {
      return `${prefix}${normalizedPath}`
    }
    return `${prefix}"${normalizedPath}"`
  }

  async function runFdSearch(command, args) {
    return await new Promise((resolve) => {
      let child
      try {
        child = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch {
        resolve(undefined)
        return
      }

      let stdout = ""
      let resolved = false
      const finish = (value) => {
        if (resolved) return
        resolved = true
        resolve(value)
      }

      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk) => {
        stdout += chunk
      })
      child.on("error", (error) => {
        if (error?.code === "ENOENT") {
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
        const results = []
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

  async function walkDirectoryWithFd(baseDir, query = "", maxResults = 100) {
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

    return []
  }

  async function completionEntryIsDirectory(entry, fullPath) {
    if (entry?.isDirectory()) return true
    if (!entry?.isSymbolicLink()) return false
    try {
      return (await stat(fullPath)).isDirectory()
    } catch {
      return false
    }
  }

  async function listPathCompletionEntries(prefix, baseCwd) {
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

    let searchDir
    let searchPrefix

    if (isRootPrefix) {
      searchDir =
        rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")
          ? expandedPrefix
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

    let entries
    try {
      entries = await readdir(searchDir, { withFileTypes: true })
    } catch {
      return []
    }

    const normalizedSearchPrefix = searchPrefix.toLowerCase()
    const suggestions = []

    for (const entry of entries) {
      if (!entry.name.toLowerCase().startsWith(normalizedSearchPrefix)) {
        continue
      }

      const fullPath = join(searchDir, entry.name)
      const isDirectory = await completionEntryIsDirectory(entry, fullPath)
      let completionPath

      if (displayPrefix.endsWith("/") || displayPrefix.endsWith("\\")) {
        completionPath = `${displayPrefix}${entry.name}`
      } else if (displayPrefix.includes("/") || displayPrefix.includes("\\")) {
        if (displayPrefix === "~") {
          completionPath = `~/${entry.name}`
        } else if (displayPrefix.startsWith("~/")) {
          const homeRelativeDir = displayPrefix.slice(2)
          const parentDir = dirname(homeRelativeDir)
          completionPath = `~/${parentDir === "." ? entry.name : `${displayPath(parentDir)}/${entry.name}`}`
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

  async function resolveScopedFileReferenceQuery(rawQuery, baseCwd) {
    const normalizedQuery = displayPath(rawQuery)
    const slashIndex = normalizedQuery.lastIndexOf("/")
    if (slashIndex === -1) {
      return null
    }

    const displayBase = normalizedQuery.slice(0, slashIndex + 1)
    const query = normalizedQuery.slice(slashIndex + 1)
    let searchBaseDir
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

  function scopedDisplayPath(displayBase, relativePath) {
    const normalizedRelativePath = displayPath(relativePath)
    if (displayBase === "/") {
      return `/${normalizedRelativePath}`
    }
    return `${displayPath(displayBase)}${normalizedRelativePath}`
  }

  function scoreFileReferenceEntry(filePath, query, isDirectory) {
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

  async function listFileReferenceEntries(
    query,
    baseCwd,
    { isQuotedPrefix = false } = {}
  ) {
    const normalizedQuery = typeof query === "string" ? query : ""
    const scopedQuery = await resolveScopedFileReferenceQuery(
      normalizedQuery,
      baseCwd
    )
    const searchBaseDir = scopedQuery?.searchBaseDir ?? baseCwd
    const searchQuery = scopedQuery?.query ?? normalizedQuery
    const entries = await walkDirectoryWithFd(searchBaseDir, searchQuery, 100)

    const scoredEntries = entries
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

    return scoredEntries.map((entry) => {
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

  function serializeModel(model) {
    if (!model) return undefined
    return {
      id: model.id,
      provider: model.provider,
      name: model.name,
      reasoning: Boolean(model.reasoning),
    }
  }

  function normalizePromptImages(rawImages) {
    if (!Array.isArray(rawImages)) return []

    return rawImages
      .map((image) => {
        if (!image || typeof image !== "object") return undefined

        const mimeType =
          typeof image.mimeType === "string" ? image.mimeType.trim() : ""
        const data = typeof image.data === "string" ? image.data.trim() : ""

        if (!mimeType || !/^image\//i.test(mimeType) || !data) return undefined
        return { type: "image", mimeType, data }
      })
      .filter(Boolean)
      .slice(0, 8)
  }

  function listAvailableModels(entry) {
    return entry.services.modelRegistry
      .getAvailable()
      .map(serializeModel)
      .sort((a, b) => {
        const providerCompare = a.provider.localeCompare(b.provider)
        if (providerCompare !== 0) return providerCompare
        return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      })
  }

  function listAvailableSkills(entry) {
    return entry.services.resourceLoader
      .getSkills()
      .skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        scope: skill.sourceInfo?.scope,
        source: skill.sourceInfo?.source,
      }))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          (a.description || "").localeCompare(b.description || "")
      )
  }

  function getContextId(url) {
    return url.searchParams.get("context") || "default"
  }

  function getSessionPath(entry) {
    return entry.session.sessionFile ?? entry.key
  }

  function getActiveEntry(context) {
    return context?.activeKey
      ? sessionEntries.get(context.activeKey)
      : undefined
  }

  function createReplayState() {
    return {
      activeRun: undefined,
      recentRun: undefined,
      nextRunIndex: 1,
    }
  }

  function cloneReplayPayload(payload) {
    try {
      return structuredClone(payload)
    } catch {
      return JSON.parse(JSON.stringify(payload))
    }
  }

  function createReplayRun(entry, baselinePayload) {
    const replay = entry.replay ?? createReplayState()
    entry.replay = replay
    const run = {
      runId: `${Date.now().toString(36)}-${(replay.nextRunIndex++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      baselinePayload: cloneReplayPayload(baselinePayload),
      events: [],
      nextSeq: 1,
      startedAt: Date.now(),
      endedAt: undefined,
    }
    replay.activeRun = run
    return run
  }

  function freshReplayRun(run) {
    if (!run) return undefined
    if (!run.endedAt) return run
    return Date.now() - run.endedAt <= REPLAY_RUN_RECENT_TTL_MS
      ? run
      : undefined
  }

  function activeReplayRun(entry) {
    return entry?.replay?.activeRun
  }

  function recentReplayRun(entry) {
    const replay = entry?.replay
    const run = freshReplayRun(replay?.recentRun)
    if (!run && replay) {
      replay.recentRun = undefined
    }
    return run
  }

  function encodeReplayEventId(sessionId, runId, seq) {
    return Buffer.from(JSON.stringify({ sessionId, runId, seq })).toString(
      "base64url"
    )
  }

  function decodeReplayEventId(value) {
    const rawValue = typeof value === "string" ? value.trim() : ""
    if (!rawValue) return undefined
    try {
      const decoded = JSON.parse(
        Buffer.from(rawValue, "base64url").toString("utf8")
      )
      return {
        sessionId:
          typeof decoded?.sessionId === "string" ? decoded.sessionId : "",
        runId: typeof decoded?.runId === "string" ? decoded.runId : "",
        seq: Number.isInteger(decoded?.seq)
          ? decoded.seq
          : Number.parseInt(decoded?.seq, 10) || 0,
      }
    } catch {
      return undefined
    }
  }

  function createSseClient(res) {
    return {
      id: `client:${cryptoRandomId()}`,
      res,
      replaying: false,
      pendingPayloads: [],
      closed: false,
    }
  }

  function closeSseClient(context, client) {
    if (!client || client.closed) return
    client.closed = true
    context.clients.delete(client)
  }

  function writePayloadToClient(context, client, payload, options = {}) {
    if (!client || client.closed) return false
    try {
      sendSseEvent(client.res, payload, options)
      return true
    } catch {
      closeSseClient(context, client)
      return false
    }
  }

  function sendPayloadToClient(context, client, payload, options = {}) {
    if (!client || client.closed) return false
    if (client.replaying) {
      client.pendingPayloads.push({ payload, options })
      return true
    }
    return writePayloadToClient(context, client, payload, options)
  }

  function flushClientPayloadQueue(context, client) {
    if (!client || client.closed || client.pendingPayloads.length === 0) return
    const queuedPayloads = client.pendingPayloads.splice(0)
    for (const queued of queuedPayloads) {
      if (
        !writePayloadToClient(context, client, queued.payload, queued.options)
      ) {
        break
      }
    }
  }

  function replayableSessionPayload(payload) {
    return Boolean(
      payload?.type && REPLAYABLE_SESSION_PAYLOAD_TYPES.has(payload.type)
    )
  }

  function normalizeSessionPayload(sessionKey, payload) {
    return payload && typeof payload === "object"
      ? { ...payload, sessionKey: payload.sessionKey ?? sessionKey }
      : payload
  }

  function startReplayRun(entry) {
    if (!entry) return undefined
    const currentRun = activeReplayRun(entry)
    if (currentRun) return currentRun
    return createReplayRun(entry, currentStatePayload(entry))
  }

  function finishReplayRun(entry) {
    const replay = entry?.replay
    const run = replay?.activeRun
    if (!run) return undefined
    run.endedAt = Date.now()
    replay.recentRun = run
    replay.activeRun = undefined
    return run
  }

  function replayRunForCursor(entry, lastEventId) {
    const cursor = decodeReplayEventId(lastEventId)
    if (
      !cursor ||
      !entry?.session?.sessionId ||
      cursor.sessionId !== entry.session.sessionId ||
      !cursor.runId
    ) {
      return undefined
    }
    const currentRun = activeReplayRun(entry)
    if (currentRun?.runId === cursor.runId) {
      return {
        run: currentRun,
        startSeq: Math.max(0, cursor.seq + 1),
        resume: true,
      }
    }
    const priorRun = recentReplayRun(entry)
    if (priorRun?.runId === cursor.runId) {
      return {
        run: priorRun,
        startSeq: Math.max(0, cursor.seq + 1),
        resume: true,
      }
    }
    return undefined
  }

  function replayPlanForConnection(entry, lastEventId) {
    const resumedPlan = replayRunForCursor(entry, lastEventId)
    if (resumedPlan) {
      return resumedPlan
    }
    const currentRun = activeReplayRun(entry)
    if (currentRun) {
      return { run: currentRun, startSeq: 0, resume: false }
    }
    return undefined
  }

  function requestLastEventId(req) {
    const headerValue = req?.headers?.["last-event-id"]
    if (Array.isArray(headerValue)) {
      return headerValue[headerValue.length - 1] || ""
    }
    return typeof headerValue === "string" ? headerValue : ""
  }

  function recordReplayEvent(entry, payload) {
    const run = activeReplayRun(entry)
    if (!run || !entry?.session?.sessionId) return undefined
    const seq = run.nextSeq
    run.nextSeq += 1
    run.events.push({ seq, payload: cloneReplayPayload(payload) })
    return encodeReplayEventId(entry.session.sessionId, run.runId, seq)
  }

  async function replayRunToClient(context, client, entry, plan) {
    if (!client || client.closed || !plan?.run) return
    client.replaying = true
    const sessionId = entry?.session?.sessionId || ""
    const run = plan.run
    const replayedEvents = run.events.filter(
      (event) => event.seq >= plan.startSeq
    )
    const replayStartPayload = {
      type: "replay_start",
      sessionKey: entry.key,
      sessionId,
      runId: run.runId,
      resume: Boolean(plan.resume),
      startSeq: plan.startSeq,
      endSeq: replayedEvents.length
        ? replayedEvents[replayedEvents.length - 1].seq
        : Math.max(0, plan.startSeq - 1),
    }
    if (!writePayloadToClient(context, client, replayStartPayload)) {
      return
    }
    if (plan.startSeq === 0) {
      const baselineId = encodeReplayEventId(sessionId, run.runId, 0)
      if (
        !writePayloadToClient(context, client, run.baselinePayload, {
          id: baselineId,
        })
      ) {
        return
      }
      if (
        !writePayloadToClient(
          context,
          client,
          await listSessionsPayload(context)
        )
      ) {
        return
      }
    }
    for (const replayEvent of replayedEvents) {
      const replayEventId = encodeReplayEventId(
        sessionId,
        run.runId,
        replayEvent.seq
      )
      if (
        !writePayloadToClient(context, client, replayEvent.payload, {
          id: replayEventId,
        })
      ) {
        return
      }
    }
    if (
      !writePayloadToClient(context, client, {
        type: "replay_end",
        sessionKey: entry.key,
        sessionId,
        runId: run.runId,
        resume: Boolean(plan.resume),
        finalSeq: replayedEvents.length
          ? replayedEvents[replayedEvents.length - 1].seq
          : Math.max(0, plan.startSeq - 1),
      })
    ) {
      return
    }
    if (plan.resume && !activeReplayRun(entry)) {
      if (!writePayloadToClient(context, client, currentStatePayload(entry))) {
        return
      }
      if (
        !writePayloadToClient(
          context,
          client,
          await listSessionsPayload(context)
        )
      ) {
        return
      }
    }
    client.replaying = false
    flushClientPayloadQueue(context, client)
  }

  function emitSessionPayload(entry, payload, options = {}) {
    if (!entry) return payload
    const nextPayload = normalizeSessionPayload(entry.key, payload)
    const shouldReplay =
      typeof options.replay === "boolean"
        ? options.replay
        : replayableSessionPayload(nextPayload)
    const eventId = shouldReplay
      ? recordReplayEvent(entry, nextPayload)
      : undefined
    broadcastToViewers(entry.key, nextPayload, { id: eventId })
    return nextPayload
  }

  function extractSessionMessageText(message) {
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

  function extractForkableUserMessages(entry) {
    const manager = entry?.session?.sessionManager
    if (!manager || typeof manager.getEntries !== "function") return []

    return manager
      .getEntries()
      .filter(
        (sessionEntry) =>
          sessionEntry?.type === "message" &&
          sessionEntry.message?.role === "user"
      )
      .map((sessionEntry, index) => ({
        entryId: typeof sessionEntry?.id === "string" ? sessionEntry.id : "",
        text: extractSessionMessageText(sessionEntry?.message).trim(),
        timestamp:
          typeof sessionEntry?.timestamp === "string"
            ? sessionEntry.timestamp
            : undefined,
        index,
      }))
      .filter((message) => message.entryId && message.text)
      .sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0
        const safeATime = Number.isFinite(aTime) ? aTime : 0
        const safeBTime = Number.isFinite(bTime) ? bTime : 0
        if (safeATime !== safeBTime) return safeBTime - safeATime
        return b.index - a.index
      })
  }

  function extractSessionContentText(content) {
    if (typeof content === "string") return content.trim()
    if (!Array.isArray(content)) return ""

    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join(" ")
      .trim()
    if (text) return text

    const imageCount = content.filter(
      (part) => part?.type === "image" || part?.type === "input_image"
    ).length
    if (imageCount > 0) {
      return `${imageCount} image${imageCount === 1 ? "" : "s"}`
    }

    return ""
  }

  function truncateTreeText(value, maxLength = 200) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text) return ""
    return text.length > maxLength ? text.slice(0, maxLength) : text
  }

  function formatTreeToolCallPreview(name, args = {}) {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const shortenPath = (value) => {
      const path = typeof value === "string" ? value : ""
      if (!path) return ""
      return home && path.startsWith(home)
        ? `~${path.slice(home.length)}`
        : path
    }

    switch (name) {
      case "read": {
        const path = shortenPath(String(args.path || args.file_path || ""))
        const offset = args.offset
        const limit = args.limit
        let display = path
        if (offset !== undefined || limit !== undefined) {
          const start = offset ?? 1
          const end = limit !== undefined ? start + limit - 1 : ""
          display += `:${start}${end ? `-${end}` : ""}`
        }
        return `[read: ${display}]`
      }
      case "write": {
        const path = shortenPath(String(args.path || args.file_path || ""))
        return `[write: ${path}]`
      }
      case "edit": {
        const path = shortenPath(String(args.path || args.file_path || ""))
        return `[edit: ${path}]`
      }
      case "bash": {
        const rawCommand = String(args.command || "")
        const command = rawCommand
          .replace(/[\n\t]/g, " ")
          .trim()
          .slice(0, 50)
        return `[bash: ${command}${rawCommand.length > 50 ? "..." : ""}]`
      }
      case "grep": {
        const pattern = String(args.pattern || "")
        const path = shortenPath(String(args.path || "."))
        return `[grep: /${pattern}/ in ${path}]`
      }
      case "find": {
        const pattern = String(args.pattern || "")
        const path = shortenPath(String(args.path || "."))
        return `[find: ${pattern} in ${path}]`
      }
      case "ls": {
        const path = shortenPath(String(args.path || "."))
        return `[ls: ${path}]`
      }
      default: {
        const serializedArgs = JSON.stringify(args)
        const preview = serializedArgs.slice(0, 40)
        return `[${name}: ${preview}${serializedArgs.length > 40 ? "..." : ""}]`
      }
    }
  }

  function serializeTreeMessageContent(content) {
    const text = truncateTreeText(extractSessionContentText(content))
    const toolCalls = []

    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "toolCall") continue
        const toolName = typeof part.name === "string" ? part.name : "tool"
        toolCalls.push({
          id: typeof part.id === "string" ? part.id : "",
          name: toolName,
          preview: formatTreeToolCallPreview(
            toolName,
            part.arguments && typeof part.arguments === "object"
              ? part.arguments
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

  function serializeSessionTreeNode(node) {
    if (!node?.entry || typeof node.entry !== "object") {
      return null
    }

    const entry = node.entry
    const serialized = {
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
      const serializedContent = serializeTreeMessageContent(
        entry.message?.content
      )
      serialized.entry.message = {
        role:
          typeof entry.message?.role === "string"
            ? entry.message.role
            : "message",
        text: serializedContent.text,
        toolCalls: serializedContent.toolCalls,
        stopReason:
          typeof entry.message?.stopReason === "string"
            ? entry.message.stopReason
            : undefined,
        errorMessage: truncateTreeText(entry.message?.errorMessage),
        toolCallId:
          typeof entry.message?.toolCallId === "string"
            ? entry.message.toolCallId
            : undefined,
        toolName:
          typeof entry.message?.toolName === "string"
            ? entry.message.toolName
            : undefined,
        command: truncateTreeText(entry.message?.command),
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

    const children = Array.isArray(node.children) ? node.children : []
    serialized.children = children
      .map((child) => serializeSessionTreeNode(child))
      .filter(Boolean)

    return serialized
  }

  function serializeSessionTree(entry) {
    const manager = entry?.session?.sessionManager
    if (!manager || typeof manager.getTree !== "function") {
      return {
        leafId: null,
        tree: [],
      }
    }

    const leafId =
      typeof manager.getLeafId === "function"
        ? (manager.getLeafId() ?? null)
        : null
    const roots = Array.isArray(manager.getTree()) ? manager.getTree() : []

    return {
      leafId,
      tree: roots.map((node) => serializeSessionTreeNode(node)).filter(Boolean),
    }
  }

  function cloneSessionData(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value))
  }

  function createForkedInMemorySessionManager(
    sourceManager,
    leafId,
    parentSession
  ) {
    const nextManager = sdk.SessionManager.inMemory(sourceManager.getCwd())
    nextManager.newSession({ parentSession })

    if (!leafId) {
      return nextManager
    }

    const branchEntries = sourceManager.getBranch(leafId)
    if (!Array.isArray(branchEntries) || branchEntries.length === 0) {
      throw new Error(`Entry ${leafId} not found`)
    }

    const pathWithoutLabels = branchEntries
      .filter((branchEntry) => branchEntry?.type !== "label")
      .map((branchEntry) => cloneSessionData(branchEntry))
    const header = cloneSessionData(
      nextManager.getHeader?.() ?? nextManager.fileEntries?.[0]
    )
    if (!header) {
      throw new Error("Failed to initialize forked in-memory session.")
    }

    const labelEntries = []
    let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id ?? null
    for (const branchEntry of pathWithoutLabels) {
      const label =
        typeof sourceManager.getLabel === "function"
          ? sourceManager.getLabel(branchEntry.id)
          : undefined
      if (typeof label !== "string" || !label) continue
      const timestamp =
        sourceManager.labelTimestampsById?.get?.(branchEntry.id) ||
        new Date().toISOString()
      const labelEntry = {
        type: "label",
        id: `label:${cryptoRandomId()}`,
        parentId,
        timestamp,
        targetId: branchEntry.id,
        label,
      }
      labelEntries.push(labelEntry)
      parentId = labelEntry.id
    }

    nextManager.fileEntries = [header, ...pathWithoutLabels, ...labelEntries]
    nextManager.flushed = false
    nextManager._buildIndex?.()
    return nextManager
  }

  async function createForkedSessionEntry(sourceEntry, entryId) {
    const currentManager = sourceEntry?.session?.sessionManager
    const selectedEntry = currentManager?.getEntry?.(entryId)

    if (
      !selectedEntry ||
      selectedEntry.type !== "message" ||
      selectedEntry.message?.role !== "user"
    ) {
      throw new Error("Invalid entry ID for forking")
    }

    const selectedText = extractSessionMessageText(selectedEntry.message)
    const previousSessionFile = sourceEntry.session.sessionFile
    const sourceSessionDir = currentManager?.getSessionDir?.()
    const sessionStartEvent = {
      type: "session_start",
      reason: "fork",
      previousSessionFile,
    }

    let sessionManager
    if (currentManager?.isPersisted?.()) {
      if (!selectedEntry.parentId) {
        sessionManager = sdk.SessionManager.create(
          sourceEntry.cwd,
          sourceSessionDir
        )
        sessionManager.newSession({ parentSession: previousSessionFile })
      } else {
        const currentSessionFile = sourceEntry.session.sessionFile
        if (!currentSessionFile) {
          throw new Error("Persisted session is missing a session file")
        }
        const sourceManager = sdk.SessionManager.open(
          currentSessionFile,
          sourceSessionDir,
          sourceEntry.cwd
        )
        const branchedPath = sourceManager.createBranchedSession(
          selectedEntry.parentId
        )
        if (!branchedPath) {
          throw new Error("Failed to create forked session")
        }
        sessionManager = sdk.SessionManager.open(
          branchedPath,
          sourceSessionDir,
          sourceEntry.cwd
        )
      }
    } else {
      sessionManager = createForkedInMemorySessionManager(
        currentManager,
        selectedEntry.parentId,
        previousSessionFile
      )
    }

    const nextEntry = await createSessionEntry(
      sessionManager,
      sessionStartEvent,
      {
        draft: !selectedEntry.parentId,
      }
    )
    const forkSessionName = await createForkSessionName(sourceEntry)
    if (forkSessionName && nextEntry.session.sessionName !== forkSessionName) {
      nextEntry.session.setSessionName(forkSessionName)
      if (nextEntry.sessionNaming) {
        nextEntry.sessionNaming.managedSessionName = forkSessionName
      }
      syncSessionMetadata(nextEntry)
    }
    nextEntry.uiState.editorText = selectedText
    if (!selectedEntry.parentId) {
      nextEntry.firstMessageHint = selectedText
    }
    touchSessionEntry(nextEntry)

    return {
      nextEntry,
      selectedText,
    }
  }

  async function navigateSessionTree(entry, targetId, navigateOptions) {
    const result = await entry.session.navigateTree(targetId, navigateOptions)

    if (result.cancelled) {
      return result
    }

    if (result.editorText != null) {
      entry.uiState.editorText = result.editorText
      emitSessionPayload(entry, {
        type: "ui_editor_text",
        text: result.editorText,
        mode: "set",
      })
    }

    if (result.summaryEntry) {
      touchSessionEntry(entry)
      await broadcastSessionsAll()
    }

    emitSessionPayload(entry, currentStatePayload(entry))
    return result
  }

  function getSessionFirstMessage(session, firstMessageHint = "") {
    const messages = Array.isArray(session?.messages) ? session.messages : []

    for (const message of messages) {
      if (message?.role !== "user") continue
      const text = extractSessionMessageText(message)
      if (text) return text
    }

    return typeof firstMessageHint === "string" ? firstMessageHint.trim() : ""
  }

  function normalizeWhitespace(text) {
    return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : ""
  }

  function normalizeSessionListName(value) {
    const text = normalizeWhitespace(value)
    return text || undefined
  }

  function normalizeSessionListTitle(value, maxLength = 240) {
    const text = normalizeWhitespace(value)
    if (!text) return ""
    if (text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
  }

  function getSessionListTitle(entry) {
    const explicitName = normalizeSessionListName(entry?.name)
    if (explicitName && explicitName !== "Current session") return explicitName
    const fallback = normalizeSessionListTitle(entry?.firstMessage)
    return fallback || "New session"
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function stripForkSessionSuffix(value) {
    const normalized = normalizeWhitespace(value)
    return normalized.replace(/\s+fork\s+\d+$/i, "").trim() || normalized
  }

  function parseForkSessionIndex(name, baseName) {
    const normalizedName = normalizeWhitespace(name)
    const normalizedBaseName = normalizeWhitespace(baseName)
    if (!normalizedName || !normalizedBaseName) return undefined

    const match = normalizedName.match(
      new RegExp(`^${escapeRegex(normalizedBaseName)}\\s+fork\\s+(\\d+)$`, "i")
    )
    if (!match) return undefined

    const index = Number.parseInt(match[1], 10)
    return Number.isInteger(index) && index > 0 ? index : undefined
  }

  function buildForkSessionName(baseName, forkIndex) {
    const normalizedBaseName =
      stripForkSessionSuffix(
        cleanupSessionNameCandidate(baseName) || baseName || "Session"
      ) || "Session"
    const suffix = ` fork ${forkIndex}`
    const maxLength = 48
    const availableBaseLength = maxLength - suffix.length

    if (availableBaseLength <= 1) {
      return `Fork ${forkIndex}`
    }

    const plainBaseName =
      normalizedBaseName.replace(/…+$/g, "").trim() || "Session"
    if (plainBaseName.length <= availableBaseLength) {
      return `${plainBaseName}${suffix}`
    }

    const truncatedBaseName = plainBaseName
      .slice(0, Math.max(1, availableBaseLength - 1))
      .trimEnd()
    return `${truncatedBaseName}…${suffix}`
  }

  async function createForkSessionName(sourceEntry) {
    const baseName =
      stripForkSessionSuffix(
        getSessionListTitle({
          name: sourceEntry?.session?.sessionName,
          firstMessage: getSessionFirstMessage(
            sourceEntry?.session,
            sourceEntry?.firstMessageHint
          ),
        })
      ) || "Session"
    let maxForkIndex = 0

    const considerName = (value) => {
      const index = parseForkSessionIndex(value, baseName)
      if (index && index > maxForkIndex) {
        maxForkIndex = index
      }
    }

    for (const entry of sessionEntries.values()) {
      if (entry.cwd !== sourceEntry.cwd) continue
      considerName(entry.session.sessionName)
    }

    if (!options.noSession) {
      for (const entry of await listSessionIndexEntries()) {
        if (entry.cwd !== sourceEntry.cwd) continue
        considerName(entry.name)
      }
    }

    return buildForkSessionName(baseName, maxForkIndex + 1)
  }

  function normalizeModifiedTimestamp(value) {
    if (!value) return undefined
    const timestamp = new Date(value).getTime()
    if (Number.isNaN(timestamp)) return undefined
    return new Date(timestamp).toISOString()
  }

  function modifiedTimestampValue(value) {
    if (!value) return 0
    const timestamp = new Date(value).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
  }

  function laterModifiedTimestamp(...values) {
    let nextValue
    let nextTime = 0

    for (const value of values) {
      const normalized = normalizeModifiedTimestamp(value)
      const timestamp = modifiedTimestampValue(normalized)
      if (!timestamp || timestamp < nextTime) continue
      nextValue = normalized
      nextTime = timestamp
    }

    return nextValue
  }

  function touchSessionEntry(entry, value = new Date()) {
    const nextValue =
      value instanceof Date
        ? value.toISOString()
        : normalizeModifiedTimestamp(value)
    if (!nextValue) return
    entry.modifiedAt =
      laterModifiedTimestamp(entry.modifiedAt, nextValue) || nextValue
  }

  async function sessionEntryModified(entry) {
    let modified = laterModifiedTimestamp(entry?.modifiedAt)

    if (entry?.session?.sessionFile) {
      try {
        modified =
          laterModifiedTimestamp(
            modified,
            (await stat(entry.session.sessionFile)).mtime.toISOString()
          ) || modified
      } catch {
        // ignore missing session metadata
      }
    }

    return modified
  }

  function mergeSessionListEntry(target, fallback) {
    if (!target || !fallback) return fallback
    target.path = fallback.path || target.path
    target.id = fallback.id || target.id
    target.cwd = fallback.cwd || target.cwd
    target.name = fallback.name || target.name
    target.title = fallback.title || target.title
    target.modified = laterModifiedTimestamp(target.modified, fallback.modified)
    return target
  }

  function serializeSessionListEntry(entry, context, streamingPaths) {
    const path =
      typeof entry?.path === "string" && entry.path ? entry.path : undefined
    const name = normalizeSessionListName(entry?.name)
    return {
      path,
      id: entry?.id,
      cwd: entry?.cwd,
      name,
      title: getSessionListTitle(entry),
      modified: entry?.modified,
      streaming: Boolean(path) && streamingPaths.has(path),
      unread: Boolean(path) && context.unreadFinished.has(path),
    }
  }

  function getCurrentSessionName(entry) {
    return cleanupSessionNameCandidate(entry?.session?.sessionName)
  }

  function createSessionNamingState() {
    return {
      nonce: 0,
      pendingGeneration: false,
      managedSessionName: undefined,
      disposed: false,
    }
  }

  function setCurrentSessionName(entry, name) {
    const nextName = cleanupSessionNameCandidate(name)
    if (!nextName) return false
    if (entry.session.sessionName === nextName) return false
    entry.session.setSessionName(nextName)
    syncSessionMetadata(entry)
    return true
  }

  function setTreeEntryLabel(entry, targetId, label) {
    const nextTargetId = typeof targetId === "string" ? targetId.trim() : ""
    if (!nextTargetId) {
      throw new Error("entryId is required")
    }

    const nextLabel = typeof label === "string" ? label.trim() : ""
    const sessionManager = entry?.session?.sessionManager
    if (
      !sessionManager ||
      typeof sessionManager.appendLabelChange !== "function"
    ) {
      throw new Error("Label editing is not available for this session.")
    }

    const currentLabel =
      typeof sessionManager.getLabel === "function"
        ? sessionManager.getLabel(nextTargetId) || ""
        : ""
    if (currentLabel === nextLabel) {
      return false
    }

    sessionManager.appendLabelChange(nextTargetId, nextLabel || undefined)
    emitSessionPayload(entry, currentStatePayload(entry))
    return true
  }

  function extractFirstUserPrompt(entry) {
    const messages = Array.isArray(entry?.session?.messages)
      ? entry.session.messages
      : []
    for (const message of messages) {
      if (message?.role !== "user") continue
      const summary = summarizePromptContent(message.content)
      if (summary.text || summary.imageCount > 0) return summary
    }

    const firstMessageHint =
      typeof entry?.firstMessageHint === "string"
        ? entry.firstMessageHint.trim()
        : ""
    if (firstMessageHint) {
      return { text: firstMessageHint, imageCount: 0 }
    }

    return undefined
  }

  function applyManagedSessionName(entry, name, mode) {
    const naming = entry.sessionNaming ?? createSessionNamingState()
    entry.sessionNaming = naming

    const nextName = cleanupSessionNameCandidate(name)
    if (!nextName) return false

    const currentName = getCurrentSessionName(entry)
    if (mode === "initial") {
      if (currentName) return false
    } else if (currentName && currentName !== naming.managedSessionName) {
      return false
    }

    if (currentName !== nextName) {
      setCurrentSessionName(entry, nextName)
    }
    naming.managedSessionName = nextName
    return true
  }

  function autoSessionNamingPromptPreview(text, maxLength = 160) {
    const normalized = normalizeWhitespace(text)
    if (!normalized) return ""
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
  }

  function logAutoSessionNamingFailure(
    entry,
    { heuristicReason, refinementReason, text, imageCount } = {}
  ) {
    const payload = {
      type: "auto_session_naming_error",
      sessionId: entry?.session?.sessionId,
      cwd: entry?.cwd,
      promptPreview: autoSessionNamingPromptPreview(text) || undefined,
      imageCount: Number.isFinite(imageCount) ? imageCount : 0,
      heuristicReason: heuristicReason || undefined,
      refinementReason: refinementReason || undefined,
    }
    console.error("[pi-web] auto session naming failed:", payload)
    emitSessionPayload(entry, payload, { replay: false })
  }

  function scheduleSessionNameRefinement(
    entry,
    text,
    imageCount,
    { heuristicReason } = {}
  ) {
    const naming = entry.sessionNaming ?? createSessionNamingState()
    entry.sessionNaming = naming
    if (naming.pendingGeneration) return

    naming.pendingGeneration = true
    const nonce = naming.nonce
    const sessionId = entry.session.sessionId

    void (async () => {
      try {
        const generated = await generateSessionNameWithLlm(
          entry,
          text,
          imageCount
        )
        if (!generated?.name) {
          if (
            !naming.disposed &&
            nonce === naming.nonce &&
            sessionId === entry.session.sessionId &&
            !getCurrentSessionName(entry)
          ) {
            logAutoSessionNamingFailure(entry, {
              heuristicReason,
              refinementReason:
                generated?.reason ||
                "session name refinement returned no usable title",
              text,
              imageCount,
            })
          }
          return
        }
        if (
          naming.disposed ||
          nonce !== naming.nonce ||
          sessionId !== entry.session.sessionId
        )
          return
        applyManagedSessionName(entry, generated.name, "refine")
      } catch (error) {
        if (
          !naming.disposed &&
          nonce === naming.nonce &&
          sessionId === entry.session.sessionId &&
          !getCurrentSessionName(entry)
        ) {
          logAutoSessionNamingFailure(entry, {
            heuristicReason,
            refinementReason: formatError(error),
            text,
            imageCount,
          })
        }
      } finally {
        if (nonce === naming.nonce) {
          naming.pendingGeneration = false
        }
      }
    })()
  }

  function startAutoSessionNaming(entry, text, imageCount) {
    if (getCurrentSessionName(entry)) return

    const heuristic = deriveHeuristicSessionNameAttempt(text, imageCount)
    if (heuristic?.name) {
      applyManagedSessionName(entry, heuristic.name, "initial")
    }
    scheduleSessionNameRefinement(entry, text, imageCount, {
      heuristicReason: heuristic?.reason,
    })
  }

  function maybeAutoNameSession(entry) {
    if (getCurrentSessionName(entry)) return
    const firstPrompt = extractFirstUserPrompt(entry)
    if (!firstPrompt) return
    startAutoSessionNaming(entry, firstPrompt.text, firstPrompt.imageCount)
  }

  function disposeSessionNaming(entry) {
    if (!entry?.sessionNaming) return
    entry.sessionNaming.disposed = true
    entry.sessionNaming.nonce += 1
    entry.sessionNaming.pendingGeneration = false
  }

  function getEntryStreamingState(entry) {
    if (!entry) return false
    if (typeof entry.streamingState === "boolean") return entry.streamingState
    return Boolean(entry.session.isStreaming)
  }

  async function runSerializedPromptRequest(entry, handler) {
    const previous = entry?.promptRequestChain ?? Promise.resolve()
    let release
    const current = new Promise((resolve) => {
      release = resolve
    })
    if (entry) {
      entry.promptRequestChain = previous.catch(() => {}).then(() => current)
    }
    await previous.catch(() => {})
    try {
      return await handler()
    } finally {
      release?.()
    }
  }

  function hasVisibleSessionContent(entry) {
    return (
      Boolean(entry) &&
      (entry.session.messages.length > 0 || getEntryStreamingState(entry))
    )
  }

  function isDraftEntry(entry) {
    return Boolean(entry?.draft) && !hasVisibleSessionContent(entry)
  }

  function normalizePendingUserMessage(message) {
    return {
      pendingId:
        typeof message?.pendingId === "string" && message.pendingId
          ? message.pendingId
          : `pending:${cryptoRandomId()}`,
      text: typeof message?.text === "string" ? message.text : "",
      images: normalizePromptImages(message?.images),
      queued: true,
      streamingBehavior:
        message?.streamingBehavior === "steer" ? "steer" : "followUp",
    }
  }

  function clonePendingUserMessage(message) {
    return normalizePendingUserMessage(message)
  }

  function sortPendingUserMessages(messages) {
    const pendingMessages = Array.isArray(messages)
      ? messages.map(clonePendingUserMessage)
      : []
    return [
      ...pendingMessages.filter(
        (message) => message.streamingBehavior === "steer"
      ),
      ...pendingMessages.filter(
        (message) => message.streamingBehavior !== "steer"
      ),
    ]
  }

  function getSessionQueueState(entry) {
    return {
      steering:
        typeof entry.session.getSteeringMessages === "function"
          ? [...entry.session.getSteeringMessages()]
          : [],
      followUp:
        typeof entry.session.getFollowUpMessages === "function"
          ? [...entry.session.getFollowUpMessages()]
          : [],
    }
  }

  function reconcilePendingUserMessages(
    entry,
    queueState = getSessionQueueState(entry)
  ) {
    const steering = Array.isArray(queueState?.steering)
      ? queueState.steering.filter((text) => typeof text === "string")
      : []
    const followUp = Array.isArray(queueState?.followUp)
      ? queueState.followUp.filter((text) => typeof text === "string")
      : []
    const pending = Array.isArray(entry.pendingUserMessages)
      ? entry.pendingUserMessages.map(clonePendingUserMessage)
      : []
    const steeringCounts = new Map()
    const followUpCounts = new Map()

    for (const text of steering) {
      steeringCounts.set(text, (steeringCounts.get(text) ?? 0) + 1)
    }
    for (const text of followUp) {
      followUpCounts.set(text, (followUpCounts.get(text) ?? 0) + 1)
    }

    const nextPending = []
    for (const message of pending) {
      const counts =
        message.streamingBehavior === "steer" ? steeringCounts : followUpCounts
      const count = counts.get(message.text) ?? 0
      if (count > 0) {
        nextPending.push(message)
        counts.set(message.text, count - 1)
      }
    }

    for (const text of steering) {
      const count = steeringCounts.get(text) ?? 0
      if (count <= 0) continue
      nextPending.push(
        clonePendingUserMessage({
          text,
          images: [],
          queued: true,
          streamingBehavior: "steer",
        })
      )
      steeringCounts.set(text, count - 1)
    }

    for (const text of followUp) {
      const count = followUpCounts.get(text) ?? 0
      if (count <= 0) continue
      nextPending.push(
        clonePendingUserMessage({
          text,
          images: [],
          queued: true,
          streamingBehavior: "followUp",
        })
      )
      followUpCounts.set(text, count - 1)
    }

    entry.pendingUserMessages = sortPendingUserMessages(nextPending)
    return entry.pendingUserMessages
  }

  async function replacePendingUserMessages(entry, pendingMessages) {
    const nextPending = sortPendingUserMessages(pendingMessages)
    const canReplayPending = Boolean(entry?.session?.isStreaming)

    if (!canReplayPending && nextPending.length > 0) {
      throw new Error(
        "Pending prompts can only be changed while the session is streaming."
      )
    }

    entry.pendingQueueMutation = true

    try {
      entry.session.clearQueue()
      entry.pendingUserMessages = []

      if (canReplayPending) {
        for (const message of nextPending) {
          const text = typeof message.text === "string" ? message.text : ""
          const images = normalizePromptImages(message.images)
          if (!text.trim() && images.length === 0) continue

          await entry.session.prompt(text, {
            ...(images.length > 0 ? { images } : {}),
            streamingBehavior:
              message.streamingBehavior === "steer" ? "steer" : "followUp",
          })
        }
      }

      entry.pendingUserMessages = nextPending
      reconcilePendingUserMessages(entry)
    } finally {
      entry.pendingQueueMutation = false
    }

    emitSessionPayload(entry, currentStatePayload(entry))
    return entry.pendingUserMessages
  }

  function pendingMessagesFromClientUpdate(entry, pendingMessagesUpdate) {
    const pendingMessages = Array.isArray(entry?.pendingUserMessages)
      ? entry.pendingUserMessages.map(clonePendingUserMessage)
      : []
    const normalizedPendingMessagesUpdate = Array.isArray(pendingMessagesUpdate)
      ? pendingMessagesUpdate
          .map((message) => ({
            pendingId:
              typeof message?.pendingId === "string" ? message.pendingId : "",
            streamingBehavior:
              message?.streamingBehavior === "steer"
                ? "steer"
                : message?.streamingBehavior === "followUp"
                  ? "followUp"
                  : undefined,
          }))
          .filter((message) => message.pendingId)
      : []

    if (normalizedPendingMessagesUpdate.length !== pendingMessages.length) {
      throw new Error(
        "pendingMessages must include every pending prompt exactly once."
      )
    }

    const pendingMessagesById = new Map()
    for (const message of pendingMessages) {
      const pendingId =
        typeof message?.pendingId === "string" ? message.pendingId : ""
      if (!pendingId || pendingMessagesById.has(pendingId)) {
        throw new Error(
          "Pending prompt order is out of date. Refresh and try again."
        )
      }
      pendingMessagesById.set(pendingId, message)
    }

    const nextPendingMessages = []
    for (const pendingMessageUpdate of normalizedPendingMessagesUpdate) {
      const message = pendingMessagesById.get(pendingMessageUpdate.pendingId)
      if (!message) {
        throw new Error(
          "pendingMessages must include every pending prompt exactly once."
        )
      }
      nextPendingMessages.push({
        ...message,
        streamingBehavior:
          pendingMessageUpdate.streamingBehavior === "steer"
            ? "steer"
            : message.streamingBehavior,
      })
      pendingMessagesById.delete(pendingMessageUpdate.pendingId)
    }

    if (pendingMessagesById.size > 0) {
      throw new Error(
        "pendingMessages must include every pending prompt exactly once."
      )
    }

    return sortPendingUserMessages(nextPendingMessages)
  }

  async function disposeDraftIfUnused(entry) {
    if (!isDraftEntry(entry)) return
    const stillReferenced = [...contexts.values()].some(
      (context) =>
        context.activeKey === entry.key || context.draftKey === entry.key
    )
    if (!stillReferenced) {
      await disposeSessionEntry(entry)
    }
  }

  async function clearContextDraft(context) {
    const draftEntry = context.draftKey
      ? sessionEntries.get(context.draftKey)
      : undefined
    if (context.activeKey === context.draftKey) {
      context.activeKey = undefined
    }
    context.draftKey = undefined
    await disposeDraftIfUnused(draftEntry)
  }

  async function ensureSessionEntryById(sessionId, sessionStartEvent) {
    for (const entry of sessionEntries.values()) {
      if (entry.session.sessionId === sessionId) {
        return entry
      }
    }

    if (options.noSession) {
      return undefined
    }

    let sessions = []
    try {
      sessions = await sdk.SessionManager.listAll()
    } catch (error) {
      console.error("[pi-web] failed to resolve session by id:", error)
      return undefined
    }

    const match = sessions.find((entry) => entry.id === sessionId && entry.path)
    if (!match?.path) return undefined
    return ensureSessionEntryByPath(match.path, sessionStartEvent)
  }

  async function getOrCreateDraftEntry(context) {
    const desiredCwd =
      resolveScopeCwd(context.sessionScope, options.cwd) ?? options.cwd
    const existing = context.draftKey
      ? sessionEntries.get(context.draftKey)
      : undefined
    if (isDraftEntry(existing) && existing.cwd === desiredCwd) {
      context.activeKey = existing.key
      return existing
    }
    if (existing) {
      await clearContextDraft(context)
    }
    const draftEntry = await createNewSessionEntry(undefined, undefined, {
      draft: true,
      cwd: desiredCwd,
    })
    context.draftKey = draftEntry.key
    context.activeKey = draftEntry.key
    return draftEntry
  }

  async function resolveRequestedEntry(url, context) {
    async function activateRequestedEntry(entry) {
      if (context.draftKey && context.draftKey !== entry.key) {
        await clearContextDraft(context)
      }
      context.activeKey = entry.key
      if (isDraftEntry(entry)) {
        context.draftKey = entry.key
      } else if (context.draftKey === entry.key) {
        context.draftKey = undefined
      }
      context.unreadFinished.delete(getSessionPath(entry))
      return entry
    }

    const requestedSessionKey = url.searchParams.get("sessionKey")
    if (requestedSessionKey) {
      const requestedEntry = sessionEntries.get(requestedSessionKey)
      if (requestedEntry) {
        return activateRequestedEntry(requestedEntry)
      }
    }

    const requestedSessionId = url.searchParams.get("session")
    if (requestedSessionId) {
      const requestedEntry = await ensureSessionEntryById(requestedSessionId)
      if (requestedEntry) {
        return activateRequestedEntry(requestedEntry)
      }
    }

    return getOrCreateDraftEntry(context)
  }

  function sendToContext(context, payload, options = {}) {
    for (const client of [...context.clients]) {
      sendPayloadToClient(context, client, payload, options)
    }
  }

  function activeContextDirectory(context) {
    const activeKey = context?.activeKey || context?.draftKey
    const entry = activeKey ? sessionEntries.get(activeKey) : undefined
    return typeof entry?.cwd === "string" ? entry.cwd.trim() : ""
  }

  async function currentGitDirectoryPayload(cwd, { force = false } = {}) {
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
    if (!normalizedCwd) return null

    const [gitStatus, gitChanges] = await Promise.all([
      readDirectoryGitStatus(normalizedCwd, { force }),
      readDirectoryGitChanges(normalizedCwd, { force }),
    ])

    return {
      type: "git_directory_update",
      cwd: normalizedCwd,
      gitStatus,
      files: Array.isArray(gitChanges?.files)
        ? gitChanges.files
        : gitChanges === null
          ? null
          : [],
      localBranches: Array.isArray(gitChanges?.localBranches)
        ? gitChanges.localBranches
        : gitChanges === null
          ? null
          : [],
      remoteBranches: Array.isArray(gitChanges?.remoteBranches)
        ? gitChanges.remoteBranches
        : gitChanges === null
          ? null
          : [],
      commits: Array.isArray(gitChanges?.commits)
        ? gitChanges.commits
        : gitChanges === null
          ? null
          : [],
      unpushedCommitShortHashes: Array.isArray(
        gitChanges?.unpushedCommitShortHashes
      )
        ? gitChanges.unpushedCommitShortHashes
        : gitChanges === null
          ? null
          : [],
    }
  }

  function gitDirectoryPayloadSignature(payload) {
    if (!payload) return ""
    return JSON.stringify({
      cwd: payload.cwd || "",
      gitStatus: payload.gitStatus ?? null,
      files: Array.isArray(payload.files)
        ? payload.files
        : (payload.files ?? null),
      localBranches: Array.isArray(payload.localBranches)
        ? payload.localBranches
        : (payload.localBranches ?? null),
      remoteBranches: Array.isArray(payload.remoteBranches)
        ? payload.remoteBranches
        : (payload.remoteBranches ?? null),
      commits: Array.isArray(payload.commits)
        ? payload.commits
        : (payload.commits ?? null),
      unpushedCommitShortHashes: Array.isArray(
        payload.unpushedCommitShortHashes
      )
        ? payload.unpushedCommitShortHashes
        : (payload.unpushedCommitShortHashes ?? null),
    })
  }

  async function refreshLiveGitDirectory(cwd) {
    const normalizedCwd = typeof cwd === "string" ? cwd.trim() : ""
    if (!normalizedCwd) return

    const liveState = gitLiveDirectoryStates.get(normalizedCwd) || {
      signature: "",
      polling: false,
    }
    if (liveState.polling) return
    liveState.polling = true
    gitLiveDirectoryStates.set(normalizedCwd, liveState)

    try {
      const payload = await currentGitDirectoryPayload(normalizedCwd, {
        force: true,
      })
      const signature = gitDirectoryPayloadSignature(payload)
      if (signature === liveState.signature) {
        return
      }
      liveState.signature = signature
      for (const context of contexts.values()) {
        if (context.clients.size === 0) continue
        if (activeContextDirectory(context) !== normalizedCwd) continue
        sendToContext(context, payload)
      }
    } catch {
      // ignore transient git polling errors
    } finally {
      liveState.polling = false
      gitLiveDirectoryStates.set(normalizedCwd, liveState)
    }
  }

  async function refreshLiveGitDirectories() {
    const activeDirectories = new Set()
    for (const context of contexts.values()) {
      if (context.clients.size === 0) continue
      const cwd = activeContextDirectory(context)
      if (cwd) activeDirectories.add(cwd)
    }

    for (const trackedCwd of [...gitLiveDirectoryStates.keys()]) {
      if (!activeDirectories.has(trackedCwd)) {
        gitLiveDirectoryStates.delete(trackedCwd)
      }
    }

    await Promise.all(
      [...activeDirectories].map((cwd) => refreshLiveGitDirectory(cwd))
    )
  }

  function requestLiveGitRefresh() {
    if (gitLiveRefreshScheduled) return
    gitLiveRefreshScheduled = true
    queueMicrotask(() => {
      gitLiveRefreshScheduled = false
      void refreshLiveGitDirectories()
    })
  }

  function broadcastToViewers(sessionKey, payload, options = {}) {
    const nextPayload = normalizeSessionPayload(sessionKey, payload)
    for (const context of contexts.values()) {
      if (context.activeKey === sessionKey) {
        sendToContext(context, nextPayload, options)
      }
    }
  }

  function sessionMetadataPayload(entry, options = {}) {
    const session = entry.session
    const payload = {
      type: "session_meta",
      sessionKey: entry.key,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionName: session.sessionName,
      firstMessage: getSessionFirstMessage(session, entry.firstMessageHint),
      cwd: entry.cwd,
      modified: entry.modifiedAt,
      draft: isDraftEntry(entry),
      streaming: getEntryStreamingState(entry),
    }

    if (options.includePendingUserMessages) {
      payload.pendingUserMessages = Array.isArray(entry.pendingUserMessages)
        ? entry.pendingUserMessages.map(clonePendingUserMessage)
        : []
    }

    return payload
  }

  function currentStatePayload(entry) {
    const session = entry.session
    const firstMessage = getSessionFirstMessage(session, entry.firstMessageHint)
    return {
      type: "state_sync",
      sessionKey: entry.key,
      messages: session.messages,
      pendingUserMessages: Array.isArray(entry.pendingUserMessages)
        ? entry.pendingUserMessages.map(clonePendingUserMessage)
        : [],
      draft: isDraftEntry(entry),
      streaming: getEntryStreamingState(entry),
      streamingMessage: getEntryStreamingState(entry)
        ? session.state.streamingMessage
        : undefined,
      contextUsage: session.getContextUsage(),
      hideThinkingBlock: entry.services.settingsManager.getHideThinkingBlock(),
      model: serializeModel(session.model),
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      availableModels: listAvailableModels(entry),
      availableSkills: listAvailableSkills(entry),
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionName: session.sessionName,
      firstMessage,
      cwd: entry.cwd,
      modified: entry.modifiedAt,
      uiState: entry.uiState,
    }
  }

  function syncSessionMetadata(entry) {
    emitSessionPayload(entry, sessionMetadataPayload(entry))
    void broadcastSessionsAll()
  }

  function installSessionMetadataSync(entry) {
    if (entry.restoreSessionMetadataSync) return

    const manager = entry.session.sessionManager
    if (!manager || typeof manager.appendSessionInfo !== "function") return

    const originalAppendSessionInfo = manager.appendSessionInfo.bind(manager)
    manager.appendSessionInfo = (...args) => {
      const result = originalAppendSessionInfo(...args)
      syncSessionMetadata(entry)
      return result
    }

    entry.restoreSessionMetadataSync = () => {
      manager.appendSessionInfo = originalAppendSessionInfo
      entry.restoreSessionMetadataSync = undefined
    }
  }

  async function sessionFallbackInfo(entry) {
    const firstMessage = getSessionFirstMessage(
      entry.session,
      entry.firstMessageHint
    )

    return {
      path: entry.session.sessionFile,
      id: entry.session.sessionId,
      cwd: entry.cwd,
      name: entry.session.sessionName,
      title: getSessionListTitle({
        name: entry.session.sessionName,
        firstMessage,
      }),
      modified: await sessionEntryModified(entry),
    }
  }

  function compareSessionListEntriesByModified(a, b) {
    const aTime = modifiedTimestampValue(a?.modified)
    const bTime = modifiedTimestampValue(b?.modified)
    return bTime - aTime
  }

  async function listSessionIndexEntries() {
    if (options.noSession) return []

    try {
      return (await sdk.SessionManager.listAll()).filter(
        (entry) => (entry.messageCount ?? 0) > 0
      )
    } catch (error) {
      console.error("[pi-web] failed to list sessions:", error)
      return []
    }
  }

  function listKnownDirectories(allSessions) {
    return [
      ...new Set([
        options.cwd,
        ...allSessions.map((entry) => entry.cwd),
        ...[...sessionEntries.values()].map((entry) => entry.cwd),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }

  async function listEntriesForDirectory(allSessions, directoryPath) {
    const sessions = allSessions
      .filter((entry) => entry.cwd === directoryPath)
      .map((entry) => ({ ...entry }))

    const byPath = new Map(
      sessions.filter((entry) => entry.path).map((entry) => [entry.path, entry])
    )
    const byId = new Map(
      sessions.filter((entry) => entry.id).map((entry) => [entry.id, entry])
    )
    for (const entry of sessionEntries.values()) {
      if (entry.cwd !== directoryPath || !hasVisibleSessionContent(entry))
        continue
      const fallback = await sessionFallbackInfo(entry)
      const existing =
        (fallback.path && byPath.get(fallback.path)) ||
        (fallback.id && byId.get(fallback.id))
      if (existing) {
        mergeSessionListEntry(existing, fallback)
        continue
      }
      sessions.unshift(fallback)
      if (fallback.path) {
        byPath.set(fallback.path, fallback)
      }
      if (fallback.id) {
        byId.set(fallback.id, fallback)
      }
    }

    return sessions.sort(compareSessionListEntriesByModified)
  }

  async function listDirectorySessionsPayload(
    context,
    directoryPath,
    { offset = 0, limit = 5 } = {}
  ) {
    const normalizedDirectoryPath =
      typeof directoryPath === "string" ? directoryPath.trim() : ""
    const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0
    const safeLimit =
      Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 5
    const allSessions = await listSessionIndexEntries()
    const directorySessions = await listEntriesForDirectory(
      allSessions,
      normalizedDirectoryPath
    )
    const streamingPaths = new Set(
      [...sessionEntries.values()]
        .filter((entry) => getEntryStreamingState(entry))
        .map((entry) => getSessionPath(entry))
    )

    return {
      ok: true,
      directory: normalizedDirectoryPath,
      totalCount: directorySessions.length,
      offset: safeOffset,
      limit: safeLimit,
      sessions: directorySessions
        .slice(safeOffset, safeOffset + safeLimit)
        .map((entry) =>
          serializeSessionListEntry(entry, context, streamingPaths)
        ),
    }
  }

  async function listDirectorySessionSearchIndexPayload(
    context,
    directoryPath
  ) {
    const normalizedDirectoryPath =
      typeof directoryPath === "string" ? directoryPath.trim() : ""
    const allSessions = await listSessionIndexEntries()
    const directorySessions = await listEntriesForDirectory(
      allSessions,
      normalizedDirectoryPath
    )
    const streamingPaths = new Set(
      [...sessionEntries.values()]
        .filter((entry) => getEntryStreamingState(entry))
        .map((entry) => getSessionPath(entry))
    )

    return {
      ok: true,
      directory: normalizedDirectoryPath,
      totalCount: directorySessions.length,
      revision: createDirectorySessionRevision(
        normalizedDirectoryPath,
        directorySessions
      ),
      sessions: directorySessions.map((entry) =>
        serializeSessionListEntry(entry, context, streamingPaths)
      ),
    }
  }

  function createDirectorySessionRevision(directoryPath, entries) {
    const hash = createHash("sha1")
    hash.update(directoryPath)

    for (const entry of entries) {
      hash.update("\n")
      hash.update(String(entry?.id || ""))
      hash.update("\0")
      hash.update(String(entry?.path || ""))
      hash.update("\0")
      hash.update(String(entry?.name || ""))
      hash.update("\0")
      hash.update(String(entry?.title || getSessionListTitle(entry)))
      hash.update("\0")
      hash.update(String(entry?.modified || ""))
    }

    return hash.digest("hex")
  }

  async function listDirectoryStates(allSessions) {
    const directoryPaths = listKnownDirectories(allSessions)
    return Promise.all(
      directoryPaths.map(async (directoryPath) => {
        const entries = await listEntriesForDirectory(
          allSessions,
          directoryPath
        )
        return {
          path: directoryPath,
          totalCount: entries.length,
          revision: createDirectorySessionRevision(directoryPath, entries),
        }
      })
    )
  }

  async function listSessionsPayload(context) {
    const allSessions = await listSessionIndexEntries()
    const activeEntry = getActiveEntry(context)

    return {
      type: "sessions",
      directories: listKnownDirectories(allSessions),
      directoryStates: await listDirectoryStates(allSessions),
      activeSessionPath: activeEntry?.session.sessionFile,
      activeSessionId: activeEntry?.session.sessionId,
      activeSessionKey: activeEntry?.key,
    }
  }

  async function sendStateToContext(context) {
    const entry = getActiveEntry(context)
    if (!entry) return
    sendToContext(context, currentStatePayload(entry))
  }

  async function sendSessionsToContext(context) {
    sendToContext(context, await listSessionsPayload(context))
  }

  async function broadcastStatesAll() {
    await Promise.all(
      [...contexts.values()].map((context) => sendStateToContext(context))
    )
  }

  async function broadcastSessionsAll() {
    await Promise.all(
      [...contexts.values()].map((context) => sendSessionsToContext(context))
    )
  }

  function ensureContext(id) {
    let context = contexts.get(id)
    if (context) return context
    context = {
      id,
      clients: new Set(),
      activeKey: undefined,
      draftKey: undefined,
      sessionScope: options.cwd,
      unreadFinished: new Set(),
    }
    contexts.set(id, context)
    return context
  }

  function markUnreadFinished(entry) {
    const sessionPath = getSessionPath(entry)
    for (const context of contexts.values()) {
      if (context.activeKey !== entry.key) {
        context.unreadFinished.add(sessionPath)
      }
    }
  }

  async function activateContextSession(context, entry) {
    const previousDraft =
      context.draftKey && context.draftKey !== entry.key
        ? sessionEntries.get(context.draftKey)
        : undefined
    context.activeKey = entry.key
    if (context.draftKey && context.draftKey !== entry.key) {
      context.draftKey = undefined
      await disposeDraftIfUnused(previousDraft)
    }
    if (isDraftEntry(entry)) {
      context.draftKey = entry.key
    }
    context.unreadFinished.delete(getSessionPath(entry))
    await sendStateToContext(context)
    await sendSessionsToContext(context)
    requestLiveGitRefresh()
  }

  async function bindSessionEntry(entry) {
    entry.unsubscribe?.()
    const session = entry.session

    const createUiContext = () => {
      function broadcast(payload) {
        emitSessionPayload(entry, payload)
      }

      function createDialogPromise(defaultValue, request, parseResponse) {
        if (request.signal?.aborted) return Promise.resolve(defaultValue)
        const id = cryptoRandomId()
        return new Promise((resolve) => {
          let timeoutId
          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId)
            request.signal?.removeEventListener("abort", onAbort)
            pendingUiRequests.delete(id)
          }
          const onAbort = () => {
            cleanup()
            resolve(defaultValue)
          }
          request.signal?.addEventListener("abort", onAbort, { once: true })
          if (request.timeout) {
            timeoutId = setTimeout(() => {
              cleanup()
              resolve(defaultValue)
            }, request.timeout)
          }
          pendingUiRequests.set(id, {
            resolve: (response) => {
              cleanup()
              resolve(parseResponse(response))
            },
          })
          broadcast({ type: "extension_ui_request", id, ...request.payload })
        })
      }

      return {
        select(title, options, opts) {
          return createDialogPromise(
            undefined,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "select",
                title,
                options,
                timeout: opts?.timeout,
              },
            },
            (response) => (response.cancelled ? undefined : response.value)
          )
        },
        confirm(title, message, opts) {
          return createDialogPromise(
            false,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "confirm",
                title,
                message,
                timeout: opts?.timeout,
              },
            },
            (response) =>
              response.cancelled ? false : Boolean(response.confirmed)
          )
        },
        input(title, placeholder, opts) {
          return createDialogPromise(
            undefined,
            {
              signal: opts?.signal,
              timeout: opts?.timeout,
              payload: {
                method: "input",
                title,
                placeholder,
                timeout: opts?.timeout,
              },
            },
            (response) => (response.cancelled ? undefined : response.value)
          )
        },
        editor(title, prefill) {
          return createDialogPromise(
            undefined,
            {
              signal: undefined,
              timeout: undefined,
              payload: { method: "editor", title, prefill },
            },
            (response) => (response.cancelled ? undefined : response.value)
          )
        },
        notify(message, type = "info") {
          broadcast({
            type: "extension_ui_request",
            id: cryptoRandomId(),
            method: "notify",
            message,
            notifyType: type,
          })
        },
        onTerminalInput() {
          return () => {}
        },
        setStatus(key, text) {
          if (text == null || text === "") {
            delete entry.uiState.statuses[key]
          } else {
            entry.uiState.statuses[key] = text
          }
          broadcast({ type: "ui_status", key, text })
        },
        setWorkingMessage(message) {
          entry.uiState.workingMessage = message
          broadcast({ type: "ui_working_message", message })
        },
        setHiddenThinkingLabel(label) {
          entry.uiState.hiddenThinkingLabel = label
          broadcast({ type: "ui_hidden_thinking_label", label })
        },
        setWidget(key, content) {
          if (content == null) {
            return
          }
          broadcast({
            type: "extension_ui_request",
            id: cryptoRandomId(),
            method: "notify",
            notifyType: "warning",
            message: `Extension widget ${key} is not supported in pi-web browser mode.`,
          })
        },
        setFooter() {},
        setHeader() {},
        setTitle(title) {
          entry.uiState.title = title
          broadcast({ type: "ui_title", title })
        },
        async custom() {
          throw new Error(
            "Custom extension UI is not supported in pi-web browser mode."
          )
        },
        pasteToEditor(text) {
          entry.uiState.editorText = `${entry.uiState.editorText ?? ""}${text}`
          broadcast({
            type: "ui_editor_text",
            text: entry.uiState.editorText,
            mode: "paste",
          })
        },
        setEditorText(text) {
          entry.uiState.editorText = text
          broadcast({ type: "ui_editor_text", text, mode: "set" })
        },
        getEditorText() {
          return entry.uiState.editorText ?? ""
        },
        setEditorComponent() {},
        theme: identityTheme,
        getAllThemes() {
          return []
        },
        getTheme() {
          return undefined
        },
        setTheme() {
          return {
            success: false,
            error: "Theme switching is not supported in pi-web browser mode.",
          }
        },
      }
    }

    const viewers = () =>
      [...contexts.values()].filter(
        (context) => context.activeKey === entry.key
      )

    await session.bindExtensions({
      uiContext: createUiContext(),
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async (newSessionOptions) => {
          const nextEntry = await createNewSessionEntry(
            newSessionOptions,
            undefined,
            { draft: true, cwd: entry.cwd }
          )
          for (const context of viewers()) {
            context.draftKey = nextEntry.key
            await activateContextSession(context, nextEntry)
          }
          await broadcastSessionsAll()
          return { sessionId: undefined, sessionFile: undefined }
        },
        fork: async (branchEntryId) => {
          const branchedPath =
            session.sessionManager.createBranchedSession(branchEntryId)
          if (!branchedPath) {
            return { cancelled: true }
          }
          const nextEntry = await ensureSessionEntryByPath(branchedPath)
          for (const context of viewers()) {
            await activateContextSession(context, nextEntry)
          }
          await broadcastSessionsAll()
          return {
            sessionId: nextEntry.session.sessionId,
            sessionFile: nextEntry.session.sessionFile,
          }
        },
        navigateTree: async (targetId, navigateOptions) => {
          const result = await navigateSessionTree(
            entry,
            targetId,
            navigateOptions
          )
          return { cancelled: result.cancelled, aborted: result.aborted }
        },
        switchSession: async (sessionPath) => {
          const nextEntry = await ensureSessionEntryByPath(sessionPath)
          for (const context of viewers()) {
            await activateContextSession(context, nextEntry)
          }
          await broadcastSessionsAll()
          return {
            sessionId: nextEntry.session.sessionId,
            sessionFile: nextEntry.session.sessionFile,
          }
        },
        reload: async () => {
          await session.reload()
          await bindSessionEntry(entry)
          emitSessionPayload(entry, currentStatePayload(entry))
          await broadcastSessionsAll()
        },
      },
      shutdownHandler: () => {
        void shutdown("requested by extension")
      },
      onError: (error) => {
        emitSessionPayload(entry, { type: "extension_error", ...error })
      },
    })

    entry.unsubscribe = session.subscribe((event) => {
      void handleSessionEvent(entry, event)
    })
  }

  async function createSessionEntry(
    sessionManager,
    sessionStartEvent,
    { draft = false } = {}
  ) {
    const cwd = sessionManager.getCwd()
    const services = await getServicesForCwd(cwd)
    const { session } = await sdk.createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })
    const key = session.sessionFile ?? `ephemeral:${cryptoRandomId()}`
    const existing = sessionEntries.get(key)
    if (existing) {
      session.dispose()
      return existing
    }
    const entry = {
      key,
      cwd,
      services,
      session,
      draft,
      streamingState: Boolean(session.isStreaming),
      pendingUserMessages: [],
      pendingQueueMutation: false,
      firstMessageHint: "",
      modifiedAt: undefined,
      uiState: createUiState(),
      unsubscribe: undefined,
      restoreSessionMetadataSync: undefined,
      sessionNaming: createSessionNamingState(),
      replay: createReplayState(),
      promptRequestChain: Promise.resolve(),
      lastBroadcastContextUsageSignature: "",
    }
    sessionEntries.set(key, entry)
    installSessionMetadataSync(entry)
    maybeAutoNameSession(entry)
    await bindSessionEntry(entry)
    return entry
  }

  async function createNewSessionEntry(
    newSessionOptions,
    sessionStartEvent,
    createOptions
  ) {
    const cwd = createOptions?.cwd ?? options.cwd
    const sessionManager = options.noSession
      ? sdk.SessionManager.inMemory(cwd)
      : sdk.SessionManager.create(cwd)
    if (
      newSessionOptions &&
      (newSessionOptions.id || newSessionOptions.parentSession)
    ) {
      sessionManager.newSession(newSessionOptions)
    }
    return createSessionEntry(sessionManager, sessionStartEvent, createOptions)
  }

  async function ensureSessionEntryByPath(sessionPath, sessionStartEvent) {
    const existing = sessionEntries.get(sessionPath)
    if (existing) return existing
    const sessionManager = sdk.SessionManager.open(sessionPath)
    return createSessionEntry(sessionManager, sessionStartEvent)
  }

  async function disposeSessionEntry(entry) {
    entry.unsubscribe?.()
    entry.restoreSessionMetadataSync?.()
    disposeSessionNaming(entry)
    try {
      if (entry.session.isStreaming) {
        await entry.session.abort()
      }
    } catch {
      // ignore abort errors during cleanup
    }
    try {
      entry.session.dispose()
    } catch (error) {
      console.error("[pi-web] session dispose error:", error)
    }
    sessionEntries.delete(entry.key)
  }

  function contextUsageSignature(contextUsage) {
    try {
      return JSON.stringify(contextUsage ?? null)
    } catch {
      return String(contextUsage ?? "")
    }
  }

  function broadcastContextUsageIfChanged(entry, { force = false } = {}) {
    const contextUsage = entry.session.getContextUsage()
    const signature = contextUsageSignature(contextUsage)
    if (!force && signature === entry.lastBroadcastContextUsageSignature) {
      return false
    }
    entry.lastBroadcastContextUsageSignature = signature
    emitSessionPayload(entry, { type: "context_usage", contextUsage })
    return true
  }

  async function handleSessionEvent(entry, event) {
    emitSessionPayload(entry, event)
    broadcastContextUsageIfChanged(entry)

    if (event.type === "queue_update") {
      if (entry.pendingQueueMutation) {
        return
      }
      const previousPendingCount = Array.isArray(entry.pendingUserMessages)
        ? entry.pendingUserMessages.length
        : 0
      reconcilePendingUserMessages(entry, event)
      if (
        !entry.session.isStreaming ||
        entry.pendingUserMessages.length > previousPendingCount
      ) {
        emitSessionPayload(entry, currentStatePayload(entry))
      }
      return
    }

    if (event.type === "message_end" && event.message?.role === "user") {
      touchSessionEntry(entry)
      reconcilePendingUserMessages(entry)
      emitSessionPayload(entry, sessionMetadataPayload(entry))
      return
    }

    if (event.type === "agent_start") {
      entry.streamingState = true
      await broadcastSessionsAll()
      return
    }

    if (event.type === "compaction_end") {
      emitSessionPayload(entry, currentStatePayload(entry))
      await broadcastSessionsAll()
      return
    }

    if (event.type === "agent_end") {
      entry.streamingState = false
      touchSessionEntry(entry)
      reconcilePendingUserMessages(entry)
      emitSessionPayload(
        entry,
        sessionMetadataPayload(entry, { includePendingUserMessages: true })
      )
      finishReplayRun(entry)
      markUnreadFinished(entry)
      await broadcastSessionsAll()
    }
  }

  async function shutdown(reason) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[pi-web] Shutting down (${reason})`)
    clearInterval(heartbeat)
    clearInterval(gitLivePoller)

    for (const context of contexts.values()) {
      for (const client of context.clients) {
        try {
          client.res.end()
        } catch {
          // ignore
        }
      }
      context.clients.clear()
    }

    for (const pending of pendingUiRequests.values()) {
      try {
        pending.resolve({ cancelled: true })
      } catch {
        // ignore
      }
    }
    pendingUiRequests.clear()

    for (const entry of [...sessionEntries.values()]) {
      await disposeSessionEntry(entry)
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  server = http.createServer(async (req, res) => {
    let url
    let context
    let activeEntry

    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

      if (req.method === "POST" && url.pathname === "/api/highlight") {
        const body = await readJsonBody(req)
        try {
          sendJson(res, 200, {
            ok: true,
            ...highlightCodePayload(body.code, body.language),
          })
        } catch (error) {
          if (!highlightLoadErrorLogged) {
            highlightLoadErrorLogged = true
            console.warn(
              `[pi-web:warn] Syntax highlighting unavailable: ${formatError(error)}`
            )
          }
          sendJson(res, 200, { ok: true, unavailable: true })
        }
        return
      }

      context = ensureContext(getContextId(url))
      context.sessionScope = normalizeSessionScope(
        url.searchParams.get("scope"),
        options.cwd
      )
      activeEntry = await resolveRequestedEntry(url, context)

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        })
        res.write(": connected\n\n")
        const client = createSseClient(res)
        context.clients.add(client)
        requestLiveGitRefresh()
        const replayPlan = replayPlanForConnection(
          activeEntry,
          requestLastEventId(req)
        )
        if (replayPlan) {
          await replayRunToClient(context, client, activeEntry, replayPlan)
        } else {
          writePayloadToClient(
            context,
            client,
            currentStatePayload(activeEntry)
          )
          writePayloadToClient(
            context,
            client,
            await listSessionsPayload(context)
          )
        }
        const cleanup = () => {
          closeSseClient(context, client)
          if (context.clients.size === 0) {
            const draftEntry = context.draftKey
              ? sessionEntries.get(context.draftKey)
              : undefined
            contexts.delete(context.id)
            void disposeDraftIfUnused(draftEntry)
          }
        }
        req.on("close", cleanup)
        res.on("close", cleanup)
        return
      }

      if (req.method === "GET" && url.pathname === "/api/directory-sessions") {
        const directoryPath = url.searchParams.get("directory") || ""
        const offsetValue = Number.parseInt(
          url.searchParams.get("offset") || "0",
          10
        )
        const limitValue = Number.parseInt(
          url.searchParams.get("limit") || "5",
          10
        )

        if (!directoryPath.trim()) {
          sendJson(res, 400, { error: "directory is required" })
          return
        }

        sendJson(
          res,
          200,
          await listDirectorySessionsPayload(context, directoryPath, {
            offset: Number.isNaN(offsetValue) ? 0 : offsetValue,
            limit: Number.isNaN(limitValue) ? 5 : limitValue,
          })
        )
        return
      }

      if (
        req.method === "GET" &&
        url.pathname === "/api/directory-sessions-index"
      ) {
        const directoryPath = url.searchParams.get("directory") || ""

        if (!directoryPath.trim()) {
          sendJson(res, 400, { error: "directory is required" })
          return
        }

        sendJson(
          res,
          200,
          await listDirectorySessionSearchIndexPayload(context, directoryPath)
        )
        return
      }

      if (req.method === "GET" && url.pathname === "/api/git-status") {
        const requestedCwd = url.searchParams.get("cwd") || ""
        if (!requestedCwd.trim()) {
          sendJson(res, 400, { error: "cwd is required" })
          return
        }

        const baseCwd =
          activeEntry.cwd ||
          resolveScopeCwd(context.sessionScope, options.cwd) ||
          options.cwd
        let directoryPath
        try {
          directoryPath = await resolveDirectoryPath(requestedCwd, baseCwd)
        } catch (error) {
          sendJson(res, 400, { error: formatError(error) })
          return
        }

        sendJson(res, 200, {
          ok: true,
          cwd: directoryPath,
          gitStatus: await readDirectoryGitStatus(directoryPath),
        })
        return
      }

      if (req.method === "GET" && url.pathname === "/api/git-changes") {
        const requestedCwd = url.searchParams.get("cwd") || ""
        if (!requestedCwd.trim()) {
          sendJson(res, 400, { error: "cwd is required" })
          return
        }

        const baseCwd =
          activeEntry.cwd ||
          resolveScopeCwd(context.sessionScope, options.cwd) ||
          options.cwd
        let directoryPath
        try {
          directoryPath = await resolveDirectoryPath(requestedCwd, baseCwd)
        } catch (error) {
          sendJson(res, 400, { error: formatError(error) })
          return
        }

        const gitChanges = await readDirectoryGitChanges(directoryPath)
        sendJson(res, 200, {
          ok: true,
          cwd: directoryPath,
          files: Array.isArray(gitChanges?.files)
            ? gitChanges.files
            : gitChanges === null
              ? null
              : [],
          localBranches: Array.isArray(gitChanges?.localBranches)
            ? gitChanges.localBranches
            : gitChanges === null
              ? null
              : [],
          remoteBranches: Array.isArray(gitChanges?.remoteBranches)
            ? gitChanges.remoteBranches
            : gitChanges === null
              ? null
              : [],
          commits: Array.isArray(gitChanges?.commits)
            ? gitChanges.commits
            : gitChanges === null
              ? null
              : [],
          unpushedCommitShortHashes: Array.isArray(
            gitChanges?.unpushedCommitShortHashes
          )
            ? gitChanges.unpushedCommitShortHashes
            : gitChanges === null
              ? null
              : [],
        })
        return
      }

      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, {
          ok: true,
          sessionId: activeEntry.session.sessionId,
          cwd: activeEntry.cwd,
          streaming: activeEntry.session.isStreaming,
          activeSessions: sessionEntries.size,
          contexts: contexts.size,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/prompt") {
        const body = await readJsonBody(req)
        const message = typeof body.message === "string" ? body.message : ""
        const images = normalizePromptImages(body.images)
        if (!message.trim() && images.length === 0) {
          sendJson(res, 400, { error: "message or image is required" })
          return
        }
        const streamingBehavior =
          body.streamingBehavior === "steer"
            ? "steer"
            : body.streamingBehavior === "followUp"
              ? "followUp"
              : undefined

        await runSerializedPromptRequest(activeEntry, async () => {
          const promptOptions = images.length > 0 ? { images } : {}
          const promotedDraft = isDraftEntry(activeEntry)
          const isAlreadyStreaming = getEntryStreamingState(activeEntry)
          if (!isAlreadyStreaming) {
            startReplayRun(activeEntry)
          }
          const firstPromptMissing = !getSessionFirstMessage(
            activeEntry.session,
            activeEntry.firstMessageHint
          )
          if (firstPromptMissing) {
            activeEntry.firstMessageHint = message.trim()
            startAutoSessionNaming(activeEntry, message.trim(), images.length)
          }

          if (isAlreadyStreaming) {
            const queuedStreamingBehavior = streamingBehavior ?? "steer"
            touchSessionEntry(activeEntry)
            await activeEntry.session.prompt(message, {
              ...promptOptions,
              streamingBehavior: queuedStreamingBehavior,
            })
            activeEntry.pendingUserMessages.push({
              pendingId: `pending:${cryptoRandomId()}`,
              text: message,
              images,
              queued: true,
              streamingBehavior: queuedStreamingBehavior,
            })
            reconcilePendingUserMessages(activeEntry)
            emitSessionPayload(activeEntry, currentStatePayload(activeEntry))
            await broadcastSessionsAll()
            sendJson(res, 200, { ok: true, queued: true })
            return
          }

          activeEntry.streamingState = true
          touchSessionEntry(activeEntry)

          if (promotedDraft) {
            activeEntry.draft = false
            if (context.draftKey === activeEntry.key) {
              context.draftKey = undefined
            }
            emitSessionPayload(activeEntry, sessionMetadataPayload(activeEntry))
            await broadcastSessionsAll()
          }

          emitSessionPayload(activeEntry, {
            type: "user_message",
            message,
            images,
            queued: false,
          })
          const promptPromise = Promise.resolve()
            .then(() => activeEntry.session.prompt(message, promptOptions))
            .catch((error) => {
              const endedRun = !activeEntry.session.isStreaming
              if (endedRun) {
                activeEntry.streamingState = false
                reconcilePendingUserMessages(activeEntry)
                emitSessionPayload(
                  activeEntry,
                  currentStatePayload(activeEntry)
                )
                void broadcastSessionsAll()
              }
              console.error("[prompt error]", error)
              emitSessionPayload(activeEntry, {
                type: "request_error",
                scope: "prompt",
                message,
                error: formatError(error),
              })
              if (endedRun) {
                finishReplayRun(activeEntry)
              }
            })
          void promptPromise
          sendJson(res, 200, { ok: true, queued: false })
        })
        return
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/pending-messages/reorder"
      ) {
        const body = await readJsonBody(req)
        const pendingMessages = Array.isArray(body.pendingMessages)
          ? body.pendingMessages
          : Array.isArray(body.pendingIds)
            ? body.pendingIds.map((pendingId) => ({ pendingId }))
            : null

        if (!pendingMessages) {
          sendJson(res, 400, { error: "pendingMessages must be an array" })
          return
        }

        let nextPendingMessages
        try {
          nextPendingMessages = pendingMessagesFromClientUpdate(
            activeEntry,
            pendingMessages
          )
        } catch (error) {
          sendJson(res, 400, { error: formatError(error) })
          return
        }

        if (
          !activeEntry.session.isStreaming &&
          nextPendingMessages.length > 0
        ) {
          sendJson(res, 409, {
            error:
              "Pending prompts can only be changed while the session is streaming.",
          })
          return
        }

        await replacePendingUserMessages(activeEntry, nextPendingMessages)
        sendJson(res, 200, {
          ok: true,
          pendingMessages: nextPendingMessages.map((message) => ({
            pendingId: message.pendingId,
            streamingBehavior: message.streamingBehavior,
          })),
        })
        return
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/pending-message/remove"
      ) {
        const body = await readJsonBody(req)
        const pendingId =
          typeof body.pendingId === "string" ? body.pendingId : ""

        if (!pendingId) {
          sendJson(res, 400, { error: "pendingId is required" })
          return
        }

        const pendingMessages = Array.isArray(activeEntry.pendingUserMessages)
          ? activeEntry.pendingUserMessages.map(clonePendingUserMessage)
          : []
        const pendingIndex = pendingMessages.findIndex(
          (message) => message.pendingId === pendingId
        )

        if (pendingIndex === -1) {
          sendJson(res, 404, { error: "Pending prompt not found" })
          return
        }

        pendingMessages.splice(pendingIndex, 1)
        if (!activeEntry.session.isStreaming && pendingMessages.length > 0) {
          sendJson(res, 409, {
            error:
              "Pending prompts can only be changed while the session is streaming.",
          })
          return
        }

        await replacePendingUserMessages(activeEntry, pendingMessages)
        sendJson(res, 200, { ok: true, pendingId })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/slash-command") {
        const body = await readJsonBody(req)
        const name = typeof body.name === "string" ? body.name.trim() : ""
        const args = typeof body.args === "string" ? body.args : ""
        const command = BUILTIN_SLASH_COMMANDS.get(name)

        if (!command) {
          sendJson(res, 404, {
            error: `Unknown slash command: /${name || "(empty)"}`,
          })
          return
        }

        const result = await command.run(activeEntry, args)
        sendJson(res, 200, {
          ok: true,
          commandName: name,
          ...(result && typeof result === "object" ? result : {}),
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/model") {
        const body = await readJsonBody(req)
        const provider = typeof body.provider === "string" ? body.provider : ""
        const modelId = typeof body.modelId === "string" ? body.modelId : ""

        if (!provider || !modelId) {
          sendJson(res, 400, { error: "provider and modelId are required" })
          return
        }

        const model = activeEntry.services.modelRegistry
          .getAvailable()
          .find((entry) => entry.provider === provider && entry.id === modelId)

        if (!model) {
          sendJson(res, 404, { error: `Unknown model: ${provider}/${modelId}` })
          return
        }

        await activeEntry.session.setModel(model)
        await sendStateToContext(context)
        sendJson(res, 200, {
          ok: true,
          model: serializeModel(activeEntry.session.model),
          thinkingLevel: activeEntry.session.thinkingLevel,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/thinking") {
        const body = await readJsonBody(req)
        const level = typeof body.level === "string" ? body.level : ""

        if (!VALID_THINKING_LEVELS.has(level)) {
          sendJson(res, 400, {
            error: `Invalid thinking level: ${level || "(empty)"}`,
          })
          return
        }

        activeEntry.session.setThinkingLevel(level)
        await sendStateToContext(context)
        sendJson(res, 200, {
          ok: true,
          thinkingLevel: activeEntry.session.thinkingLevel,
          availableThinkingLevels:
            activeEntry.session.getAvailableThinkingLevels(),
        })
        return
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/settings/hide-thinking"
      ) {
        const body = await readJsonBody(req)
        const hide = Boolean(body.hide)
        for (const service of servicesByCwd.values()) {
          service.settingsManager.setHideThinkingBlock(hide)
        }
        await broadcastStatesAll()
        sendJson(res, 200, { ok: true, hideThinkingBlock: hide })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/directory/resolve") {
        const body = await readJsonBody(req)
        const pathInput = typeof body.path === "string" ? body.path : ""
        const baseCwd =
          activeEntry.cwd ||
          resolveScopeCwd(context.sessionScope, options.cwd) ||
          options.cwd
        const directoryPath = await resolveDirectoryPath(pathInput, baseCwd)
        sendJson(res, 200, { ok: true, path: directoryPath })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/path-completions") {
        const body = await readJsonBody(req)
        const prefix = typeof body.prefix === "string" ? body.prefix : ""
        const baseCwd =
          activeEntry.cwd ||
          resolveScopeCwd(context.sessionScope, options.cwd) ||
          options.cwd
        const items = await listPathCompletionEntries(prefix, baseCwd)
        sendJson(res, 200, {
          ok: true,
          prefix,
          totalCount: items.length,
          items,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/file-completions") {
        const body = await readJsonBody(req)
        const query = typeof body.query === "string" ? body.query : ""
        const isQuotedPrefix = Boolean(body.isQuotedPrefix)
        const baseCwd =
          activeEntry.cwd ||
          resolveScopeCwd(context.sessionScope, options.cwd) ||
          options.cwd
        const items = await listFileReferenceEntries(query, baseCwd, {
          isQuotedPrefix,
        })
        sendJson(res, 200, {
          ok: true,
          query,
          totalCount: items.length,
          items,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/abort") {
        activeEntry.session.abortCompaction?.()
        activeEntry.session.abortBranchSummary?.()
        await activeEntry.session.abort()
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/new") {
        const body = await readJsonBody(req)
        const requestedCwd =
          typeof body.cwd === "string" && body.cwd.trim()
            ? await resolveDirectoryPath(
                body.cwd,
                activeEntry.cwd ||
                  resolveScopeCwd(context.sessionScope, options.cwd) ||
                  options.cwd
              )
            : undefined
        const nextEntry = await createNewSessionEntry(undefined, undefined, {
          draft: true,
          cwd:
            requestedCwd ||
            resolveScopeCwd(context.sessionScope, options.cwd) ||
            activeEntry.cwd,
        })
        context.draftKey = nextEntry.key
        await activateContextSession(context, nextEntry)
        await broadcastSessionsAll()
        sendJson(res, 200, { ok: true, draft: true })
        return
      }

      if (req.method === "GET" && url.pathname === "/api/session/tree") {
        const tree = serializeSessionTree(activeEntry)
        sendJson(res, 200, {
          ok: true,
          leafId: tree.leafId,
          tree: tree.tree,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/tree/label") {
        const body = await readJsonBody(req)
        const entryId =
          typeof body.entryId === "string" ? body.entryId.trim() : ""
        const label = typeof body.label === "string" ? body.label : ""

        if (!entryId) {
          sendJson(res, 400, { error: "entryId is required" })
          return
        }

        try {
          setTreeEntryLabel(activeEntry, entryId, label)
        } catch (error) {
          sendJson(res, 400, {
            error:
              error instanceof Error
                ? error.message
                : "Failed to update label.",
          })
          return
        }

        const tree = serializeSessionTree(activeEntry)
        sendJson(res, 200, {
          ok: true,
          leafId: tree.leafId,
          tree: tree.tree,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/tree") {
        const body = await readJsonBody(req)
        const targetId =
          typeof body.targetId === "string" ? body.targetId.trim() : ""
        const summarize = Boolean(body.summarize)
        const customInstructions =
          typeof body.customInstructions === "string"
            ? body.customInstructions
            : undefined

        if (!targetId) {
          sendJson(res, 400, { error: "targetId is required" })
          return
        }

        const result = await navigateSessionTree(activeEntry, targetId, {
          summarize,
          customInstructions,
        })
        sendJson(res, 200, {
          ok: true,
          cancelled: Boolean(result.cancelled),
          aborted: Boolean(result.aborted),
          editorText: result.editorText,
        })
        return
      }

      if (req.method === "GET" && url.pathname === "/api/session/fork") {
        sendJson(res, 200, {
          ok: true,
          messages: extractForkableUserMessages(activeEntry),
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/fork") {
        const body = await readJsonBody(req)
        const entryId =
          typeof body.entryId === "string" ? body.entryId.trim() : ""
        if (!entryId) {
          sendJson(res, 400, { error: "entryId is required" })
          return
        }

        const { nextEntry } = await createForkedSessionEntry(
          activeEntry,
          entryId
        )
        await activateContextSession(context, nextEntry)
        await broadcastSessionsAll()
        sendJson(res, 200, {
          ok: true,
          draft: isDraftEntry(nextEntry),
          sessionId: !isDraftEntry(nextEntry)
            ? nextEntry.session.sessionId
            : undefined,
          sessionFile: !isDraftEntry(nextEntry)
            ? nextEntry.session.sessionFile
            : undefined,
        })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/rename") {
        const body = await readJsonBody(req)
        const sessionPath = typeof body.path === "string" ? body.path : ""
        const nextName = typeof body.name === "string" ? body.name.trim() : ""
        if (!sessionPath) {
          sendJson(res, 400, { error: "path is required" })
          return
        }
        if (!nextName) {
          sendJson(res, 400, { error: "name is required" })
          return
        }

        const loadedEntry = sessionEntries.get(sessionPath)
        if (loadedEntry) {
          loadedEntry.session.setSessionName(nextName)
          emitSessionPayload(loadedEntry, currentStatePayload(loadedEntry))
        } else {
          const manager = sdk.SessionManager.open(sessionPath)
          manager.appendSessionInfo(nextName)
        }

        await broadcastSessionsAll()
        sendJson(res, 200, { ok: true, name: nextName })
        return
      }

      if (req.method === "POST" && url.pathname === "/api/session/delete") {
        const body = await readJsonBody(req)
        const sessionPath = typeof body.path === "string" ? body.path : ""
        if (!sessionPath) {
          sendJson(res, 400, { error: "path is required" })
          return
        }

        const loadedEntry = sessionEntries.get(sessionPath)
        let replacementEntry
        let currentContextReplacement
        if (loadedEntry) {
          const affectedContexts = [...contexts.values()].filter(
            (ctx) => ctx.activeKey === loadedEntry.key
          )
          if (affectedContexts.length > 0) {
            replacementEntry = await createNewSessionEntry(
              undefined,
              undefined,
              { draft: true, cwd: loadedEntry.cwd }
            )
            for (const affected of affectedContexts) {
              affected.draftKey = replacementEntry.key
              await activateContextSession(affected, replacementEntry)
              if (affected === context) {
                currentContextReplacement = replacementEntry
              }
            }
          }
          for (const ctx of contexts.values()) {
            ctx.unreadFinished.delete(sessionPath)
          }
          await disposeSessionEntry(loadedEntry)
        }

        try {
          await unlink(sessionPath)
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error
          }
        }

        await broadcastSessionsAll()
        sendJson(res, 200, {
          ok: true,
          sessionId:
            currentContextReplacement &&
            !isDraftEntry(currentContextReplacement)
              ? currentContextReplacement.session.sessionId
              : undefined,
          sessionFile:
            currentContextReplacement &&
            !isDraftEntry(currentContextReplacement)
              ? currentContextReplacement.session.sessionFile
              : undefined,
        })
        return
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/ui/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/ui/".length))
        const pending = pendingUiRequests.get(id)
        if (!pending) {
          sendJson(res, 404, { error: `Unknown UI request id: ${id}` })
          return
        }
        const body = await readJsonBody(req)
        pending.resolve(body)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === "GET") {
        serveStatic(req, res, STATIC_DIR)
        return
      }

      sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` })
    } catch (error) {
      const requestPath = url
        ? `${url.pathname}${url.search}`
        : (req.url ?? "/")
      const requestLabel = `${req.method ?? "UNKNOWN"} ${requestPath}`
      const remoteAddress = req.socket?.remoteAddress

      console.error(
        `[pi-web] 500 ${requestLabel}${remoteAddress ? ` (${remoteAddress})` : ""}`
      )
      if (context?.id) {
        console.error(`[pi-web] context: ${context.id}`)
      }
      if (activeEntry?.session?.sessionId) {
        console.error(`[pi-web] session: ${activeEntry.session.sessionId}`)
      }
      if (activeEntry?.cwd) {
        console.error(`[pi-web] cwd: ${activeEntry.cwd}`)
      }
      if (error instanceof Error && error.stack) {
        console.error(error.stack)
      } else {
        console.error(error)
      }

      if (!res.headersSent) {
        sendJson(res, 500, { error: formatError(error) })
      } else {
        try {
          res.end()
        } catch {
          // ignore response close errors during failure handling
        }
      }
    }
  })

  heartbeat = setInterval(() => {
    for (const context of contexts.values()) {
      for (const client of [...context.clients]) {
        try {
          client.res.write(": heartbeat\n\n")
        } catch {
          closeSseClient(context, client)
        }
      }
    }
  }, 20_000)
  heartbeat.unref?.()

  gitLivePoller = setInterval(() => {
    void refreshLiveGitDirectories()
  }, GIT_LIVE_POLL_INTERVAL_MS)
  gitLivePoller.unref?.()

  const clientUrl = toClientUrl(options.host, options.port)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, options.host, resolve)
  })

  console.log(`[pi-web] cwd: ${options.cwd}`)
  console.log(`[pi-web] listening: http://${options.host}:${options.port}`)
  console.log(`[pi-web] web ui:   ${clientUrl}`)
  console.log("[pi-web] extensions: disabled (self-contained runtime)")
  if (!isLoopbackHost(options.host)) {
    console.log(
      "[pi-web] WARNING: this server is listening on a non-loopback host. Anyone who can reach it can use your agent and tools."
    )
  }

  if (options.openBrowser) {
    try {
      openBrowser(clientUrl)
    } catch (error) {
      console.error(`[pi-web] failed to open browser: ${formatError(error)}`)
    }
  }

  const signals = ["SIGINT", "SIGTERM"]
  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(signal).finally(() => process.exit(0))
    })
  }

  return new Promise(() => {})
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
