/**
 * `pico-app machine …`: add and manage the SSH machines of a hub.
 *
 *   machine add <target> [--label L] [--data-dir D] [--yes]
 *   machine list [--json]
 *   machine status [<id-or-label>] [--json]
 *   machine reconnect <id-or-label>
 *   machine rename <id-or-label> --label L
 *   machine enable|disable|remove <id-or-label>
 *
 * `add` and `reconnect` run in a terminal, so SSH can ask for a password or
 * a host-key approval. Only `add` installs Pico, and only after the user
 * says yes. A running hub reads `machines.json` again within one second.
 */
import { readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { createInterface } from "node:readline/promises"

import { serverPaths, VERSION, type ServerPaths } from "../config.ts"
import { isLoopback } from "../security.ts"
import type { MachineInfo } from "./manager.ts"
import {
  findProfile,
  labelFromTarget,
  machineDir,
  newMachineId,
  readCache,
  readProfiles,
  validTarget,
  writeCache,
  writeProfiles,
  type MachineCache,
  type MachineProfile,
} from "./profiles.ts"
import {
  cacheFromDiscovery,
  discover,
  HUB_FEATURE,
  installRemote,
  MIN_API_CONTRACT_VERSION,
  MIN_NODE,
  picoCommand,
  remoteStatus,
  remoteSupportsHub,
  remoteVersion,
  startRemote,
} from "./remote.ts"
import { SshTransport } from "./ssh.ts"
import type { MachineTransport } from "./transport.ts"

type Options = Map<string, string | boolean>

const USAGE = `Usage:
  pico-app machine add <target> [--label L] [--data-dir D] [--yes]
  pico-app machine list [--json]
  pico-app machine status [<id-or-label>] [--json]
  pico-app machine reconnect <id-or-label>
  pico-app machine rename <id-or-label> --label L
  pico-app machine enable|disable|remove <id-or-label>

<target> is what you give to ssh: a host alias, user@host, a Tailscale
MagicDNS name, or ssh://user@host:2222. Pico uses your SSH config, keys, and
agent. It does not store passwords or keys.
--data-dir is the Pico data directory on the remote machine (default ~/.pico).
Use --hub-dir for the data directory of this hub.`

function parse(argv: string[]) {
  const positional: string[] = []
  const options: Options = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split("=", 2) as [
      string,
      string | undefined,
    ]
    if (inline !== undefined) options.set(key, inline)
    else if (
      ["label", "data-dir", "hub-dir"].includes(key) &&
      argv[index + 1] !== undefined
    )
      options.set(key, argv[++index]!)
    else options.set(key, true)
  }
  return { positional, options }
}

function stringOption(options: Options, key: string) {
  const value = options.get(key)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** The running hub, if any: its address from `server.json`. */
async function hubRequest(
  paths: ServerPaths,
  method: string,
  path: string
): Promise<unknown> {
  let state: { host?: string; port?: number }
  try {
    state = JSON.parse(readFileSync(paths.stateFile, "utf8")) as typeof state
  } catch {
    return undefined
  }
  if (!state.port) return undefined
  const host =
    !state.host || ["0.0.0.0", "::"].includes(state.host)
      ? "127.0.0.1"
      : state.host
  try {
    const response = await fetch(
      `http://${host.includes(":") ? `[${host}]` : host}:${state.port}${path}`,
      { method, signal: AbortSignal.timeout(3000) }
    )
    return response.ok ? await response.json() : undefined
  } catch {
    return undefined
  }
}

/** A JSON GET to the remote server through a transport. */
function remoteJson(transport: MachineTransport, path: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = httpRequest(
      {
        ...transport.endpoint(),
        agent: transport.agent(),
        method: "GET",
        path,
        headers: { host: "127.0.0.1" },
        timeout: 15_000,
      },
      (response) => {
        let text = ""
        response.setEncoding("utf8")
        response.on("data", (chunk: string) => {
          text += chunk
        })
        response.once("end", () => {
          try {
            resolve(JSON.parse(text) as Record<string, unknown>)
          } catch {
            reject(new Error(`${path} did not return JSON`))
          }
        })
      }
    )
    request.once("timeout", () =>
      request.destroy(new Error(`${path} did not answer in time`))
    )
    request.once("error", reject)
    request.end()
  })
}

async function ask(question: string) {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

function log(message: string) {
  console.log(message)
}

type SetupOptions = {
  install: boolean
  assumeYes: boolean
}

/**
 * Connect in the terminal, find node and pico-app, start Pico if it does
 * not run, and check its manifest. Install and update only for `add`.
 */
async function setup(
  profile: MachineProfile,
  paths: ServerPaths,
  options: SetupOptions
) {
  const transport = new SshTransport({
    profile,
    machinesDir: paths.machinesDir,
    interactive: true,
  })
  const dir = machineDir(paths.machinesDir, profile.id)
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.once("SIGINT", interrupt)
  try {
    log(`Connecting to ${profile.target} with SSH…`)
    await transport.connect(abort.signal)
    log("Connected.")

    let cache: MachineCache = cacheFromDiscovery(
      await discover(transport, abort.signal),
      readCache(dir)
    )
    if (!cache.nodeDir)
      throw new Error(
        `Node.js ${MIN_NODE.join(".")} or later was not found on ${profile.label}. Install it, then try again.`
      )
    const nodeDir = cache.nodeDir
    log(`Node.js ${cache.nodeVersion} in ${nodeDir}`)

    const confirm = (question: string) =>
      options.assumeYes ? Promise.resolve(true) : ask(question)

    let installedVersion = cache.picoPath
      ? await remoteVersion(transport, cache)
      : undefined
    const tooOld =
      installedVersion !== undefined &&
      !(await remoteSupportsHub(transport, cache))
    if (!cache.picoPath || !installedVersion || tooOld) {
      if (!options.install)
        throw new Error(
          `${tooOld ? `pico-app ${installedVersion} is too old` : "pico-app was not found"} on ${profile.label}. Run: pico-app machine add ${profile.target}`
        )
      if (
        !(await confirm(
          `${tooOld ? `pico-app ${installedVersion} on ${profile.label} is too old. Install` : "Install"} @alivault/pico@${VERSION} on ${profile.label} with npm (into ~/.local)?`
        ))
      )
        throw new Error("Canceled. Pico is not installed.")
      log("Installing…")
      await installRemote(transport, nodeDir, VERSION)
      cache = cacheFromDiscovery(await discover(transport), cache)
      installedVersion = cache.picoPath
        ? await remoteVersion(transport, cache)
        : undefined
      if (!cache.picoPath || !installedVersion)
        throw new Error(
          `pico-app is still not found on ${profile.label}. Add ~/.local/bin to PATH there.`
        )
    }
    log(`pico-app ${installedVersion} at ${cache.picoPath}`)
    writeCache(dir, cache)

    let status = await remoteStatus(transport, cache, profile)
    if (!status) {
      log(`Starting Pico on ${profile.label}…`)
      await startRemote(transport, cache, profile)
      status = await remoteStatus(transport, cache, profile)
      if (!status) throw new Error(`Pico did not start on ${profile.label}.`)
    } else if (!isLoopback(status.host)) {
      log(
        `Warning: Pico on ${profile.label} listens on ${status.host}, not only on 127.0.0.1. The hub uses SSH; you can restart it with --host 127.0.0.1.`
      )
    }
    await transport.attach(status.port)
    let manifest = await remoteJson(transport, "/api/client/manifest")
    const compatible = (value: Record<string, unknown>) => {
      const features = (value.capabilities as { features?: unknown })?.features
      return (
        Number(value.apiContractVersion ?? 0) >= MIN_API_CONTRACT_VERSION &&
        Array.isArray(features) &&
        features.includes(HUB_FEATURE)
      )
    }
    if (!compatible(manifest)) {
      if (!options.install)
        throw new Error(
          `Pico ${versionOf(manifest) ?? "(unknown version)"} on ${profile.label} is too old for this hub. Update it, or run: pico-app machine add ${profile.target}`
        )
      if (
        !(await confirm(
          `Pico ${versionOf(manifest) ?? "(unknown version)"} on ${profile.label} is too old. Update it to ${VERSION} with npm and restart it? Sessions continue after the restart.`
        ))
      )
        throw new Error("Canceled. Pico on the remote machine is not updated.")
      await installRemote(transport, nodeDir, VERSION)
      cache = cacheFromDiscovery(await discover(transport), cache)
      writeCache(dir, cache)
      await transport.exec(picoCommand(cache, profile, ["stop", "--wait"]), {
        timeoutMs: 11 * 60_000,
      })
      await startRemote(transport, cache, profile)
      status = await remoteStatus(transport, cache, profile)
      if (!status) throw new Error(`Pico did not start on ${profile.label}.`)
      await transport.attach(status.port)
      manifest = await remoteJson(transport, "/api/client/manifest")
      if (!compatible(manifest))
        throw new Error(`Pico on ${profile.label} is still not compatible.`)
    }
    writeCache(dir, {
      ...cache,
      port: status.port,
      version: versionOf(manifest) ?? status.version,
    })
    log(
      `Pico ${versionOf(manifest) ?? "(unknown version)"} runs on ${profile.label} (port ${status.port}).`
    )
  } finally {
    process.off("SIGINT", interrupt)
    // Keep the SSH master: the hub uses it without asking again.
    await transport.close()
  }
}

function versionOf(manifest: Record<string, unknown>) {
  return typeof manifest.version === "string" ? manifest.version : undefined
}

function printMachines(machines: MachineInfo[]) {
  if (machines.length === 0) {
    log("No machines. Add one with: pico-app machine add <ssh-target>")
    return
  }
  for (const machine of machines) {
    const problem = machine.problem ? ` — ${machine.problem.message}` : ""
    log(
      `${machine.id}  ${machine.label.padEnd(16)} ${machine.target.padEnd(28)} ${machine.state}${problem}`
    )
  }
}

/** The profiles, with live states from the hub when it runs. */
async function machineStates(paths: ServerPaths): Promise<MachineInfo[]> {
  const profiles = readProfiles(paths.machinesFile)
  const live = (await hubRequest(paths, "GET", "/api/machines")) as
    | { machines?: MachineInfo[] }
    | undefined
  return profiles.map((profile) => {
    const info = live?.machines?.find((machine) => machine.id === profile.id)
    if (info) {
      const { summary: _summary, ...rest } = info
      return rest
    }
    return {
      ...profile,
      state: profile.enabled ? "offline" : "disabled",
      since: 0,
      ...(profile.enabled
        ? {
            problem: {
              kind: "error" as const,
              message: "The hub is not running",
            },
          }
        : {}),
    }
  })
}

export async function machineCommand(argv: string[], hubDir: string) {
  const { positional, options } = parse(argv)
  const paths = serverPaths(stringOption(options, "hub-dir") ?? hubDir)
  const [sub, name] = positional
  const json = options.get("json") === true
  const profiles = () => readProfiles(paths.machinesFile)
  const requireProfile = () => {
    if (!name) throw new Error(USAGE)
    const profile = findProfile(profiles(), name)
    if (!profile) throw new Error(`Unknown machine: ${name}`)
    return profile
  }
  const edit = (change: (profile: MachineProfile) => void) => {
    const list = profiles()
    const profile = findProfile(list, name ?? "")
    if (!profile) throw new Error(`Unknown machine: ${name}`)
    change(profile)
    writeProfiles(paths.machinesFile, list)
    return profile
  }

  switch (sub) {
    case "add": {
      if (!name) throw new Error(USAGE)
      const target = validTarget(name)
      const list = profiles()
      const label = stringOption(options, "label") ?? labelFromTarget(target)
      if (findProfile(list, label))
        throw new Error(
          `A machine with the label ${label} exists. Use --label to choose another.`
        )
      const profile: MachineProfile = {
        id: newMachineId(list.map((entry) => entry.id)),
        label,
        target,
        dataDir: stringOption(options, "data-dir") ?? null,
        enabled: true,
      }
      await setup(profile, paths, {
        install: true,
        assumeYes: options.get("yes") === true,
      })
      // Read again: the file can have changed while setup ran.
      const latest = profiles()
      writeProfiles(paths.machinesFile, [...latest, profile])
      log(
        `Added ${profile.label} (${profile.id}). A running hub connects to it within one second.`
      )
      log(
        "Anyone who can open this hub can run commands on this machine. Keep the hub on localhost or your tailnet."
      )
      return
    }
    case "list":
    case "status": {
      const machines = await machineStates(paths)
      const selected =
        sub === "status" && name
          ? machines.filter(
              (machine) =>
                machine.id === name ||
                machine.label.toLowerCase() === name.toLowerCase()
            )
          : machines
      if (sub === "status" && name && selected.length === 0)
        throw new Error(`Unknown machine: ${name}`)
      if (json) {
        console.log(JSON.stringify(selected, null, 2))
        return
      }
      printMachines(selected)
      if (sub === "status")
        for (const machine of selected)
          if (machine.problem?.detail)
            log(`\n${machine.label}:\n${machine.problem.detail}`)
      return
    }
    case "reconnect": {
      const profile = requireProfile()
      await setup(profile, paths, { install: false, assumeYes: false })
      const retried = await hubRequest(
        paths,
        "POST",
        `/api/machines/${encodeURIComponent(profile.id)}/retry`
      )
      log(
        retried
          ? `The hub connects to ${profile.label} now.`
          : `${profile.label} is ready. Start the hub with: pico-app`
      )
      return
    }
    case "rename": {
      const label = stringOption(options, "label")
      if (!name || !label) throw new Error(USAGE)
      const other = findProfile(profiles(), label)
      if (other && other.id !== requireProfile().id)
        throw new Error(`A machine with the label ${label} exists.`)
      const profile = edit((entry) => {
        entry.label = label
      })
      log(`Renamed ${profile.id} to ${label}.`)
      return
    }
    case "enable":
    case "disable": {
      const profile = edit((entry) => {
        entry.enabled = sub === "enable"
      })
      log(`${sub === "enable" ? "Enabled" : "Disabled"} ${profile.label}.`)
      return
    }
    case "remove": {
      const profile = requireProfile()
      writeProfiles(
        paths.machinesFile,
        profiles().filter((entry) => entry.id !== profile.id)
      )
      log(
        `Removed ${profile.label}. Pico and its sessions keep running on that machine.`
      )
      return
    }
    default:
      console.log(USAGE)
      if (sub && sub !== "help") process.exitCode = 2
  }
}
