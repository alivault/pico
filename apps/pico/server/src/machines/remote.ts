/**
 * Commands that a hub runs on a remote machine through its transport: find
 * `node` and `pico-app`, read the server status, start the server, and
 * install Pico. A non-interactive SSH shell often has a short `PATH`, so the
 * search also looks in common places.
 */
import type { MachineCache, MachineProfile } from "./profiles.ts"
import {
  TransportError,
  lastLines,
  type MachineTransport,
} from "./transport.ts"

export const MIN_NODE = [22, 19] as const

/** The remote server needs this contract version and this feature. */
export const MIN_API_CONTRACT_VERSION = 1
export const HUB_FEATURE = "machine-hub"

/** No single quotes: the script goes to the remote shell in single quotes. */
const DISCOVER_SCRIPT = [
  // Pico installs into ~/.local, so its pico-app comes first.
  'P="$HOME/.local/bin:$PATH"',
  'for d in "$HOME/.volta/bin" "$HOME/.local/share/mise/shims" "$HOME/.local/share/pnpm" "$HOME/Library/pnpm" "$HOME/.bun/bin" /opt/homebrew/bin /usr/local/bin "$HOME"/.nvm/versions/node/*/bin "$HOME"/.local/share/mise/installs/node/*/bin "$HOME"/.local/share/fnm/node-versions/*/installation/bin; do P="$P:$d"; done',
  'echo "os=$(uname -s)"',
  'echo "home=$HOME"',
  "IFS=:",
  "for d in $P; do",
  '  [ -n "$d" ] || continue',
  '  [ -x "$d/node" ] && echo "node=$d $("$d/node" -v 2>/dev/null)"',
  '  [ -x "$d/pico-app" ] && echo "pico=$d/pico-app"',
  "done",
  "exit 0",
].join("\n")

export type Discovery = {
  os?: string
  home?: string
  /** Directories with a `node`, and the version of each, in PATH order. */
  nodes: Array<{ dir: string; version: string }>
  picos: string[]
}

export function parseDiscovery(stdout: string): Discovery {
  const result: Discovery = { nodes: [], picos: [] }
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=")
    if (index < 0) continue
    const key = line.slice(0, index)
    const value = line.slice(index + 1).trim()
    if (key === "os") result.os = value
    else if (key === "home") result.home = value
    else if (key === "node") {
      const space = value.lastIndexOf(" ")
      const dir = space > 0 ? value.slice(0, space) : value
      const version = space > 0 ? value.slice(space + 1) : ""
      if (!result.nodes.some((node) => node.dir === dir))
        result.nodes.push({ dir, version })
    } else if (key === "pico" && !result.picos.includes(value))
      result.picos.push(value)
  }
  return result
}

/** `v22.19.0` as numbers; undefined for anything else. */
export function parseVersion(value: string | undefined) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value?.trim() ?? "")
  return match ? match.slice(1, 4).map(Number) : undefined
}

export function versionAtLeast(value: string | undefined, minimum: number[]) {
  const version = parseVersion(value)
  if (!version) return false
  for (let index = 0; index < minimum.length; index += 1) {
    const left = version[index] ?? 0
    const right = minimum[index] ?? 0
    if (left !== right) return left > right
  }
  return true
}

/** The first `node` that is new enough. */
export function pickNode(discovery: Discovery) {
  return discovery.nodes.find((node) =>
    versionAtLeast(node.version, [...MIN_NODE])
  )
}

export async function discover(
  transport: MachineTransport,
  signal?: AbortSignal
) {
  const result = await transport.exec(["sh", "-c", DISCOVER_SCRIPT], {
    timeoutMs: 30_000,
    ...(signal ? { signal } : {}),
  })
  if (result.code !== 0)
    throw new TransportError(
      lastLines(result.stderr, 1) ||
        `The remote search for node failed (exit code ${result.code})`,
      result.code,
      lastLines(result.stderr)
    )
  return parseDiscovery(result.stdout)
}

/** Fill the cache from a search. */
export function cacheFromDiscovery(
  discovery: Discovery,
  previous: MachineCache = {}
): MachineCache {
  const node = pickNode(discovery)
  const cache: MachineCache = { ...previous }
  delete cache.nodeDir
  delete cache.nodeVersion
  delete cache.picoPath
  if (discovery.os) cache.os = discovery.os
  if (node) {
    cache.nodeDir = node.dir
    cache.nodeVersion = node.version
  }
  if (discovery.picos[0]) cache.picoPath = discovery.picos[0]
  return cache
}

/** A `pico-app` command with the found `node` in `PATH`. */
export function picoCommand(
  cache: MachineCache,
  profile: Pick<MachineProfile, "dataDir">,
  args: string[]
) {
  if (!cache.picoPath || !cache.nodeDir)
    throw new Error("pico-app or node was not found on the remote machine")
  return [
    "env",
    `PATH=${cache.nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    "PICO_OPEN=0",
    cache.picoPath,
    ...args,
    ...(profile.dataDir ? ["--data-dir", profile.dataDir] : []),
  ]
}

export type RemoteStatus = {
  pid: number
  port: number
  host: string
  version: string
}

/**
 * The status of the remote server: undefined when it is not running.
 * Throws when the command fails in another way.
 */
export async function remoteStatus(
  transport: MachineTransport,
  cache: MachineCache,
  profile: Pick<MachineProfile, "dataDir">,
  signal?: AbortSignal
): Promise<RemoteStatus | undefined> {
  const result = await transport.exec(
    picoCommand(cache, profile, ["status", "--json"]),
    { timeoutMs: 20_000, ...(signal ? { signal } : {}) }
  )
  if (
    result.code === 1 &&
    (!result.stdout.trim() || /not running/i.test(result.stdout))
  )
    return undefined
  if (result.code !== 0)
    throw new TransportError(
      lastLines(result.stderr, 1) ||
        `pico-app status failed with exit code ${result.code}`,
      result.code,
      lastLines(result.stderr)
    )
  let data: Partial<RemoteStatus>
  try {
    data = JSON.parse(result.stdout) as Partial<RemoteStatus>
  } catch {
    throw new TransportError(
      "pico-app status --json did not return JSON. Update Pico on the remote machine.",
      result.code,
      lastLines(result.stdout)
    )
  }
  if (typeof data.port !== "number" || typeof data.pid !== "number")
    throw new TransportError("pico-app status has no port", 0, "")
  return {
    pid: data.pid,
    port: data.port,
    host: String(data.host ?? ""),
    version: String(data.version ?? ""),
  }
}

export async function remoteVersion(
  transport: MachineTransport,
  cache: MachineCache
) {
  const result = await transport.exec(
    picoCommand(cache, { dataDir: null }, ["--version"]),
    { timeoutMs: 20_000 }
  )
  return result.code === 0 ? result.stdout.trim() : undefined
}

/** Whether the remote `pico-app` can work with a hub (`serve --detach`). */
export async function remoteSupportsHub(
  transport: MachineTransport,
  cache: MachineCache
) {
  const result = await transport.exec(
    picoCommand(cache, { dataDir: null }, ["--help"]),
    { timeoutMs: 20_000 }
  )
  return result.code === 0 && result.stdout.includes("--detach")
}

/** Start the remote server in the background on its loopback. */
export async function startRemote(
  transport: MachineTransport,
  cache: MachineCache,
  profile: Pick<MachineProfile, "dataDir">
) {
  const result = await transport.exec(
    picoCommand(cache, profile, [
      "serve",
      "--detach",
      "--no-open",
      "--host",
      "127.0.0.1",
    ]),
    { timeoutMs: 60_000 }
  )
  if (result.code !== 0)
    throw new TransportError(
      lastLines(result.stderr, 1) ||
        lastLines(result.stdout, 1) ||
        `pico-app serve failed with exit code ${result.code}`,
      result.code,
      lastLines(`${result.stdout}\n${result.stderr}`)
    )
}

/**
 * Install Pico with npm into `~/.local` on the remote host. This needs no
 * root and does not change the global packages of the remote `node`.
 */
export async function installRemote(
  transport: MachineTransport,
  nodeDir: string,
  version: string
) {
  const result = await transport.exec(
    [
      "sh",
      "-c",
      `PATH="${nodeDir}:/usr/local/bin:/usr/bin:/bin"; exec npm install --global --prefix "$HOME/.local" @alivault/pico@${version}`,
    ],
    { timeoutMs: 10 * 60_000 }
  )
  if (result.code !== 0)
    throw new TransportError(
      lastLines(result.stderr, 1) || `npm failed with exit code ${result.code}`,
      result.code,
      lastLines(result.stderr, 12)
    )
}

export type ConnectionProblem = {
  kind: "auth" | "stopped" | "update" | "setup" | "error"
  message: string
  /** The last lines of SSH or command errors. */
  detail?: string
  /** A URL to open, for example a Tailscale SSH check. */
  url?: string
}

const AUTH_PATTERNS = [
  /permission denied/i,
  /host key verification failed/i,
  /remote host identification has changed/i,
  /no matching host key/i,
  /too many authentication failures/i,
  /passphrase/i,
  /password/i,
  /authenticat/i,
  /login\.tailscale\.com/i,
  /to authenticate, visit/i,
]

/** Whether SSH failed because it needs the user, not because of the network. */
export function isAuthFailure(stderr: string) {
  return AUTH_PATTERNS.some((pattern) => pattern.test(stderr))
}

/** The first URL in SSH output, for example a Tailscale SSH check. */
export function firstUrl(text: string) {
  return /https:\/\/\S+/.exec(text)?.[0]?.replace(/[).,]+$/, "")
}
