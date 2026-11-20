/**
 * Updates of Smith itself: find the newest release on the chosen channel,
 * and install it the way this copy was installed. The running server keeps
 * its code until a restart loads the new files (see build-info.ts).
 *
 * Channels are npm dist-tags: `stable` is `latest`, and `preview` is the
 * newer of `next` and `latest`. The channel and the background check are
 * in `<data>/update.json`, which the CLI and the server both read fresh, so
 * neither one writes over a change of the other.
 */
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { VERSION } from "../config.ts"

export const PACKAGE_NAME = "@alivault/smith"
export const UPDATE_CHANNELS = ["stable", "preview"] as const
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return UPDATE_CHANNELS.includes(value as UpdateChannel)
}

// ---------------------------------------------------------------------------
// Versions

type ParsedVersion = { numbers: number[]; pre: string[] }

function parse(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(
    value.trim()
  )
  if (!match) return undefined
  return {
    numbers: match.slice(1, 4).map(Number),
    pre: match[4] ? match[4].split(".") : [],
  }
}

/**
 * Semver order: negative when `left` is older. A prerelease is older than
 * its release. Versions that do not parse sort first.
 */
export function compareVersions(left: string, right: string) {
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return a ? 1 : b ? -1 : 0
  for (let index = 0; index < 3; index += 1) {
    const diff = a.numbers[index]! - b.numbers[index]!
    if (diff) return Math.sign(diff)
  }
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index]
    const y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumber = /^\d+$/.test(x)
    const yNumber = /^\d+$/.test(y)
    if (xNumber && yNumber) return Math.sign(Number(x) - Number(y))
    if (xNumber !== yNumber) return xNumber ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// The install of this copy

/**
 * How this copy of Smith was installed:
 * - `npm`: `npm install --global` (with or without `--prefix`); an update
 *   installs into the same prefix.
 * - `source`: a checkout of the repository; update it with git.
 * - `other`: anything else, such as pnpm, npx, or a project dependency;
 *   Smith does not know how to update it, and shows a command instead.
 */
export type Install =
  | { kind: "npm"; root: string; prefix: string }
  | { kind: "source"; root: string }
  | { kind: "other"; root: string }

/** The package root: `apps/smith` in the repository, the package in an install. */
export function packageRoot() {
  const script = fileURLToPath(import.meta.url)
  return resolve(dirname(script), "..", "..")
}

export function detectInstall(
  root = packageRoot(),
  platform: NodeJS.Platform = process.platform
): Install {
  let real = root
  try {
    real = realpathSync(root)
  } catch {
    // Use the path as it is.
  }
  if (existsSync(join(real, "server", "src", "main.ts")))
    return { kind: "source", root: real }
  const scope = dirname(real)
  const modules = dirname(scope)
  if (
    basename(real) !== "smith" ||
    basename(scope) !== "@alivault" ||
    basename(modules) !== "node_modules" ||
    real.split(/[\\/]/).some((part) => part === ".pnpm" || part === "_npx")
  )
    return { kind: "other", root: real }
  // npm puts global packages in <prefix>/lib/node_modules, and on Windows
  // in <prefix>/node_modules.
  const above = dirname(modules)
  if (platform === "win32") return { kind: "npm", root: real, prefix: above }
  if (basename(above) === "lib")
    return { kind: "npm", root: real, prefix: dirname(above) }
  return { kind: "other", root: real }
}

/** The command that installs a version, for a person to run. */
export function installCommand(install: Install, version: string) {
  const spec = `${PACKAGE_NAME}@${version}`
  if (install.kind === "npm")
    return `npm install --global --prefix ${quote(install.prefix)} ${spec}`
  if (install.kind === "source") return "git pull && pnpm install && pnpm build"
  return `npm install --global ${spec}`
}

function quote(path: string) {
  return /^[\w@%+=:,./~-]+$/.test(path)
    ? path
    : `'${path.replace(/'/g, `'\\''`)}'`
}

/** The npm next to this Node.js, so the install uses the same Node. */
function npmCommand(platform = process.platform) {
  const dir = dirname(process.execPath)
  if (platform === "win32") {
    const local = join(dir, "npm.cmd")
    return existsSync(local) ? local : "npm.cmd"
  }
  const local = join(dir, "npm")
  return existsSync(local) ? local : "npm"
}

/**
 * Install a version into the prefix of this copy. `onOutput` gets npm's
 * output; the error has its last lines.
 */
export async function installVersion(
  install: Install,
  version: string,
  options: { onOutput?: (chunk: string) => void; signal?: AbortSignal } = {}
) {
  if (install.kind !== "npm")
    throw new Error(
      `Smith cannot update this install by itself. Run: ${installCommand(install, version)}`
    )
  const npm = npmCommand()
  const args = [
    "install",
    "--global",
    "--prefix",
    install.prefix,
    "--no-fund",
    "--no-audit",
    `${PACKAGE_NAME}@${version}`,
  ]
  const output: string[] = []
  await new Promise<void>((done, fail) => {
    const child = spawn(npm, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // npm.cmd needs a shell on Windows.
      shell: process.platform === "win32",
      // npm finds its own node next to it; keep the one that runs Smith first.
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const collect = (chunk: Buffer) => {
      const text = chunk.toString()
      output.push(text)
      options.onOutput?.(text)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", fail)
    child.on("close", (code) => {
      if (code === 0) return done()
      const tail = output.join("").trim().split("\n").slice(-12).join("\n")
      fail(
        new Error(
          `npm failed with exit code ${code}${tail ? `:\n${tail}` : ""}`
        )
      )
    })
  })
  const installed = diskVersion(install.root)
  if (installed !== version)
    throw new Error(
      `npm finished, but ${install.root} has version ${installed ?? "(unknown)"}, not ${version}.`
    )
}

/** The version of the package files on disk, which a restart runs. */
export function diskVersion(root = packageRoot()) {
  try {
    const { version } = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8")
    ) as { version?: unknown }
    return typeof version === "string" ? version : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Settings: <data>/update.json

export type UpdateConfig = {
  channel: UpdateChannel
  /** Look for a new release in the background. */
  check: boolean
}

const DEFAULT_CONFIG: UpdateConfig = { channel: "stable", check: true }

function configFile(dataDir: string) {
  return join(dataDir, "update.json")
}

export function readUpdateConfig(dataDir: string): UpdateConfig {
  try {
    const stored = JSON.parse(
      readFileSync(configFile(dataDir), "utf8")
    ) as Partial<UpdateConfig>
    return {
      channel: isUpdateChannel(stored.channel)
        ? stored.channel
        : DEFAULT_CONFIG.channel,
      check:
        typeof stored.check === "boolean" ? stored.check : DEFAULT_CONFIG.check,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeUpdateConfig(
  dataDir: string,
  change: Partial<UpdateConfig>
) {
  const next = { ...readUpdateConfig(dataDir), ...change }
  mkdirSync(dataDir, { recursive: true })
  const file = configFile(dataDir)
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2))
  renameSync(`${file}.tmp`, file)
  return next
}

// ---------------------------------------------------------------------------
// The registry

function registry() {
  const value =
    process.env.SMITH_NPM_REGISTRY ??
    process.env.npm_config_registry ??
    "https://registry.npmjs.org"
  return value.replace(/\/+$/, "")
}

/** The newest version on a channel, from the npm dist-tags. */
export async function fetchLatest(
  channel: UpdateChannel,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {}
) {
  const get = options.fetch ?? fetch
  const response = await get(
    `${registry()}/-/package/${PACKAGE_NAME.replace("/", "%2f")}/dist-tags`,
    {
      headers: { accept: "application/json" },
      signal: options.signal ?? AbortSignal.timeout(15_000),
    }
  )
  if (!response.ok)
    throw new Error(`The npm registry answered ${response.status}`)
  return latestOnChannel(
    (await response.json()) as Record<string, unknown>,
    channel
  )
}

export function latestOnChannel(
  tags: Record<string, unknown>,
  channel: UpdateChannel
) {
  const latest = typeof tags.latest === "string" ? tags.latest : undefined
  const next = typeof tags.next === "string" ? tags.next : undefined
  const candidates = [latest, channel === "preview" ? next : undefined].filter(
    (value): value is string => Boolean(value && parse(value))
  )
  if (!candidates.length)
    throw new Error(`The npm registry has no ${channel} version of Smith`)
  return candidates.reduce((best, value) =>
    compareVersions(value, best) > 0 ? value : best
  )
}

// ---------------------------------------------------------------------------
// The server's updater: a check in the background, and an install on request

export type UpdateStatus = {
  /** The version that runs now. */
  current: string
  /** The version on disk, which a restart runs. */
  installed: string
  channel: UpdateChannel
  check: boolean
  install: Install["kind"]
  /** The newest version on the channel, after a check. */
  latest?: string
  /** `latest` is newer than the installed version. */
  available: boolean
  /** A command that installs `latest`, for installs Smith cannot update. */
  command?: string
  checkedAt?: string
  checking: boolean
  installing: boolean
  /** The last check or install failed. */
  error?: string
}

const CHECK_EVERY_MS = 6 * 60 * 60_000
const FIRST_CHECK_MS = 30_000

export class Updater {
  readonly #dataDir: string
  readonly #install: Install
  #latest: string | undefined
  #latestChannel: UpdateChannel | undefined
  #checkedAt: number | undefined
  #checking: Promise<void> | undefined
  #installing: Promise<void> | undefined
  #error: string | undefined
  #timer: NodeJS.Timeout | undefined

  constructor(dataDir: string, install = detectInstall()) {
    this.#dataDir = dataDir
    this.#install = install
  }

  /**
   * Check in the background: soon after the start, then every six hours.
   * A source checkout does not check (development and tests); neither does
   * `SMITH_UPDATE_CHECK=0`.
   */
  start() {
    if (this.#install.kind === "source") return
    if (process.env.SMITH_UPDATE_CHECK === "0") return
    const tick = (delay: number) => {
      this.#timer = setTimeout(() => {
        if (readUpdateConfig(this.#dataDir).check)
          void this.check().catch(() => undefined)
        tick(CHECK_EVERY_MS)
      }, delay)
      this.#timer.unref()
    }
    tick(FIRST_CHECK_MS)
  }

  stop() {
    clearTimeout(this.#timer)
  }

  config() {
    return readUpdateConfig(this.#dataDir)
  }

  setConfig(change: Partial<UpdateConfig>) {
    const before = this.config()
    const next = writeUpdateConfig(this.#dataDir, change)
    if (next.channel !== before.channel) {
      // The last result is for the other channel.
      this.#latest = undefined
      this.#latestChannel = undefined
      this.#checkedAt = undefined
    }
    return next
  }

  status(): UpdateStatus {
    const { channel, check } = this.config()
    const installed = diskVersion(this.#install.root) ?? VERSION
    const latest = this.#latestChannel === channel ? this.#latest : undefined
    const available =
      latest !== undefined && compareVersions(latest, installed) > 0
    return {
      current: VERSION,
      installed,
      channel,
      check,
      install: this.#install.kind,
      ...(latest ? { latest } : {}),
      available,
      ...(available && this.#install.kind !== "npm"
        ? { command: installCommand(this.#install, latest!) }
        : {}),
      ...(this.#checkedAt
        ? { checkedAt: new Date(this.#checkedAt).toISOString() }
        : {}),
      checking: Boolean(this.#checking),
      installing: Boolean(this.#installing),
      ...(this.#error ? { error: this.#error } : {}),
    }
  }

  /** Ask the registry for the newest version on the channel. */
  check() {
    this.#checking ??= (async () => {
      const { channel } = this.config()
      try {
        this.#latest = await fetchLatest(channel)
        this.#latestChannel = channel
        this.#checkedAt = Date.now()
        this.#error = undefined
      } catch (error) {
        this.#error = `Could not check for updates: ${message(error)}`
        throw error
      } finally {
        this.#checking = undefined
      }
    })()
    return this.#checking
  }

  /**
   * Install the newest version in the background; `status().installing`
   * shows the progress. A restart then runs it.
   */
  install() {
    if (this.#install.kind !== "npm")
      throw new Error(
        this.#install.kind === "source"
          ? "This Smith runs from a source checkout. Update it with git."
          : `Smith cannot update this install by itself. Run: ${installCommand(this.#install, this.#latest ?? "latest")}`
      )
    if (this.#installing) return
    this.#error = undefined
    this.#installing = (async () => {
      try {
        if (!this.#latest || this.#latestChannel !== this.config().channel)
          await this.check()
        const target = this.#latest!
        const installed = diskVersion(this.#install.root) ?? VERSION
        if (compareVersions(target, installed) <= 0) return
        await installVersion(this.#install, target)
      } catch (error) {
        this.#error = `Could not install the update: ${message(error)}`
      } finally {
        this.#installing = undefined
      }
    })()
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
