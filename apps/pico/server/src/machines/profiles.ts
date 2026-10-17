/**
 * Machine profiles in `<data>/machines.json`: the SSH machines that a hub
 * shows next to its own sessions. A profile has no secrets. SSH uses the
 * user's own config, keys, and agent.
 *
 * A cache in `<data>/machines/<id>/cache.json` keeps what setup found on the
 * remote host. Pico works without it.
 */
import { randomBytes } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

export type MachineProfile = {
  /** Random and opaque, for example `m_7f3a2c`. */
  id: string
  label: string
  /** What `ssh` gets: a host alias, `user@host`, or `ssh://user@host:2222`. */
  target: string
  /** The remote data directory; null is the remote default (`~/.pico`). */
  dataDir: string | null
  enabled: boolean
}

export type MachineCache = {
  os?: string
  /** The directory of the remote `node` (22.19 or later). */
  nodeDir?: string
  nodeVersion?: string
  /** The remote `pico-app` command. */
  picoPath?: string
  port?: number
  version?: string
}

/** The ID of the hub's own runtime. Profiles never use it. */
export const LOCAL_MACHINE_ID = "local"

const ID_PATTERN = /^m_[a-z0-9]{4,32}$/

export function newMachineId(taken: Iterable<string> = []) {
  const used = new Set(taken)
  for (;;) {
    const id = `m_${randomBytes(3).toString("hex")}`
    if (!used.has(id)) return id
  }
}

/** A short label from an SSH target: `ali@workbox.ts.net:22` gives `workbox`. */
export function labelFromTarget(target: string) {
  const host = target
    .replace(/^ssh:\/\//, "")
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host
  return host.split(".")[0] || host
}

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

/** Make sure that a target cannot become an `ssh` option. */
export function validTarget(value: unknown) {
  const target = text(value, "target")
  if (target.startsWith("-") || /\s/.test(target))
    throw new Error(`Invalid SSH target: ${target}`)
  return target
}

/** Parse the text of `machines.json`. Throws on a bad file. */
export function parseProfiles(raw: string): MachineProfile[] {
  const data = JSON.parse(raw) as { version?: unknown; machines?: unknown }
  if (!data || typeof data !== "object")
    throw new Error("machines.json must be an object")
  if (data.version !== 1)
    throw new Error(
      `Unsupported machines.json version: ${String(data.version)}`
    )
  if (!Array.isArray(data.machines))
    throw new Error("machines.json needs a machines list")
  const seen = new Set<string>()
  return data.machines.map((entry: unknown, index) => {
    if (!entry || typeof entry !== "object")
      throw new Error(`Machine ${index + 1} must be an object`)
    const value = entry as Record<string, unknown>
    const id = text(value.id, "id")
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid machine ID: ${id}`)
    if (seen.has(id)) throw new Error(`Duplicate machine ID: ${id}`)
    seen.add(id)
    const target = validTarget(value.target)
    const label =
      typeof value.label === "string" && value.label.trim()
        ? value.label.trim()
        : labelFromTarget(target)
    const dataDir =
      typeof value.dataDir === "string" && value.dataDir.trim()
        ? value.dataDir.trim()
        : null
    return {
      id,
      label,
      target,
      dataDir,
      enabled: value.enabled !== false,
    }
  })
}

/** The profiles in a file; a missing file has none. Throws on a bad file. */
export function readProfiles(file: string): MachineProfile[] {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return parseProfiles(raw)
}

export function writeProfiles(file: string, machines: MachineProfile[]) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, machines }, null, 2)}\n`,
    { mode: 0o600 }
  )
  renameSync(temporary, file)
}

/** A profile by ID or by label (case-insensitive). */
export function findProfile(machines: MachineProfile[], idOrLabel: string) {
  const wanted = idOrLabel.trim()
  return (
    machines.find((machine) => machine.id === wanted) ??
    machines.find(
      (machine) => machine.label.toLowerCase() === wanted.toLowerCase()
    )
  )
}

/**
 * Call `onChange` when the file changes. Polls every half second, which
 * also works when an editor replaces the file.
 */
export function watchProfiles(file: string, onChange: () => void) {
  const listener = (
    current: { mtimeMs: number; size: number; ino: number },
    previous: { mtimeMs: number; size: number; ino: number }
  ) => {
    if (
      current.mtimeMs !== previous.mtimeMs ||
      current.size !== previous.size ||
      current.ino !== previous.ino
    )
      onChange()
  }
  watchFile(file, { interval: 500, persistent: false }, listener)
  return () => unwatchFile(file, listener)
}

export function machineDir(machinesDir: string, id: string) {
  const dir = join(machinesDir, id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function readCache(dir: string): MachineCache {
  try {
    const data = JSON.parse(
      readFileSync(join(dir, "cache.json"), "utf8")
    ) as unknown
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}
    const value = data as Record<string, unknown>
    const cache: MachineCache = {}
    for (const key of [
      "os",
      "nodeDir",
      "nodeVersion",
      "picoPath",
      "version",
    ] as const) {
      if (typeof value[key] === "string" && value[key]) cache[key] = value[key]
    }
    if (typeof value.port === "number" && Number.isInteger(value.port))
      cache.port = value.port
    return cache
  } catch {
    return {}
  }
}

export function writeCache(dir: string, cache: MachineCache) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, "cache.json")
    writeFileSync(`${file}.tmp`, JSON.stringify(cache, null, 2))
    renameSync(`${file}.tmp`, file)
  } catch (error) {
    console.warn("[pico] could not write the machine cache:", error)
  }
}
