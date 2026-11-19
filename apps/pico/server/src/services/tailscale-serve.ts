/**
 * Previews over Tailscale Serve. When the user opens Pico at
 * `https://<machine>.ts.net/` through Tailscale Serve, a preview listener on
 * plain HTTP is not reachable at `https://<machine>.ts.net:<port>/`. This
 * module adds a Serve entry for the port:
 *
 *   tailscale serve --bg --https=<port> http://127.0.0.1:<port>
 *
 * and removes it again with `tailscale serve --https=<port> off`. It records
 * the entries it adds in a file, so the next start removes the entries of a
 * Pico that stopped without cleanup. It changes only the entries that it
 * added, and only while they still proxy to the same target.
 */
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { IncomingHttpHeaders } from "node:http"
import { dirname } from "node:path"

/** Runs the tailscale CLI with the arguments and returns its output. */
export type TailscaleRunner = (args: string[]) => Promise<string>

type Entry = { port: number; target: string }

type ServeStatus = {
  TCP?: Record<string, unknown>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
}

const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
const COMMAND_TIMEOUT_MS = 15_000

function first(value: string | string[] | undefined) {
  const text = Array.isArray(value) ? value[0] : value
  return text?.split(",")[0]?.trim() ?? ""
}

/**
 * The MagicDNS host name when the request came through Tailscale Serve over
 * HTTPS, else undefined. Tailscale Serve keeps the Host header and adds
 * `X-Forwarded-Proto: https`, `X-Forwarded-Host`, and `Tailscale-*`
 * headers (https://tailscale.com/s/serve-headers).
 */
export function tailscaleHttpsHost(headers: IncomingHttpHeaders) {
  if (first(headers["x-forwarded-proto"]).toLowerCase() !== "https")
    return undefined
  const authority = first(headers["x-forwarded-host"]) || first(headers.host)
  if (!authority) return undefined
  let hostname: string
  try {
    hostname = new URL(`http://${authority}`).hostname
  } catch {
    return undefined
  }
  const fromTailscale =
    hostname.toLowerCase().endsWith(".ts.net") ||
    headers["tailscale-headers-info"] !== undefined ||
    headers["tailscale-user-login"] !== undefined
  return fromTailscale ? hostname : undefined
}

function execTailscale(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout)
          return
        }
        const output = `${stderr}`.trim() || `${stdout}`.trim()
        const failure = new Error(
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "The tailscale command is not installed"
            : error.killed
              ? `tailscale ${args.join(" ")} did not finish${output ? `: ${output}` : ""}`
              : output || error.message
        ) as NodeJS.ErrnoException
        failure.code = (error as NodeJS.ErrnoException).code
        reject(failure)
      }
    )
  })
}

/** The tailscale CLI from the PATH, or the one in the macOS app. */
export const runTailscaleCli: TailscaleRunner = async (args) => {
  try {
    return await execTailscale("tailscale", args)
  } catch (error) {
    if (
      process.platform !== "darwin" ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    )
      throw error
    return await execTailscale(MAC_APP_CLI, args)
  }
}

/** The Serve proxy target on this machine for a listener. */
export function serveTarget(host: string, port: number) {
  const local =
    !host || host === "0.0.0.0" || host === "::" || host === "localhost"
      ? "127.0.0.1"
      : host
  return `http://${local.includes(":") ? `[${local}]` : local}:${port}`
}

/** The single "/" proxy of the Serve entry for a port, if there is one. */
function proxyOf(status: ServeStatus, port: number) {
  for (const [key, web] of Object.entries(status.Web ?? {})) {
    if (!key.endsWith(`:${port}`)) continue
    const handlers = Object.entries(web.Handlers ?? {})
    if (handlers.length !== 1 || handlers[0]![0] !== "/") return null
    return handlers[0]![1].Proxy ?? null
  }
  return undefined
}

function portUsed(status: ServeStatus, port: number) {
  return (
    status.TCP?.[String(port)] !== undefined ||
    proxyOf(status, port) !== undefined
  )
}

export class TailscaleServe {
  readonly #stateFile: string
  readonly #run: TailscaleRunner
  /** Serve entries that this Pico added, by port. */
  readonly #entries = new Map<number, string>()
  /** Entries of an earlier run that could not be removed yet. */
  #stale: Entry[] = []
  /** One CLI change at a time: Serve has one config for the machine. */
  #queue: Promise<unknown> = Promise.resolve()
  readonly #ready: Promise<void>

  constructor(stateFile: string, run: TailscaleRunner = runTailscaleCli) {
    this.#stateFile = stateFile
    this.#run = run
    this.#ready = this.#serial(() => this.#removeStale()).catch(() => {})
  }

  /** Wait for the removal of the entries of an earlier run. */
  ready() {
    return this.#ready
  }

  /**
   * Serve `target` over HTTPS on the tailnet. The Serve port is `port` when
   * it is free in the Serve config, else the next free one. Returns it.
   */
  async add(port: number, target: string) {
    await this.#ready
    return this.#serial(async () => {
      for (const [added, addedTarget] of this.#entries)
        if (addedTarget === target) return added
      const status = await this.#status()
      let servePort = port
      while (portUsed(status, servePort)) {
        servePort += 1
        if (servePort > 65535)
          throw new Error("Tailscale Serve has no free port")
      }
      // Record it before the change: a crash then leaves a record, and the
      // next start removes the entry.
      this.#entries.set(servePort, target)
      await this.#save()
      try {
        await this.#run(["serve", "--bg", `--https=${servePort}`, target])
      } catch (error) {
        this.#entries.delete(servePort)
        await this.#save().catch(() => {})
        throw error
      }
      return servePort
    })
  }

  /** Remove an entry that this Pico added, if it is still unchanged. */
  async remove(port: number) {
    await this.#ready
    return this.#serial(async () => {
      const target = this.#entries.get(port)
      if (target === undefined) return
      await this.#removeIfOurs(await this.#status(), port, target)
      this.#entries.delete(port)
      await this.#save()
    })
  }

  async #removeIfOurs(status: ServeStatus, port: number, target: string) {
    if (proxyOf(status, port) !== target) return
    await this.#run(["serve", `--https=${port}`, "off"])
  }

  async #removeStale() {
    this.#stale = await this.#load()
    if (this.#stale.length === 0) return
    const status = await this.#status()
    for (const entry of this.#stale)
      await this.#removeIfOurs(status, entry.port, entry.target)
    this.#stale = []
    await this.#save()
  }

  async #status() {
    return JSON.parse(
      await this.#run(["serve", "status", "--json"])
    ) as ServeStatus
  }

  async #load(): Promise<Entry[]> {
    try {
      const value = JSON.parse(await readFile(this.#stateFile, "utf8")) as {
        entries?: unknown
      }
      return Array.isArray(value.entries)
        ? value.entries.filter(
            (entry): entry is Entry =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as Entry).port === "number" &&
              typeof (entry as Entry).target === "string"
          )
        : []
    } catch {
      return []
    }
  }

  async #save() {
    const entries = [
      ...this.#stale,
      ...[...this.#entries].map(([port, target]) => ({ port, target })),
    ]
    await mkdir(dirname(this.#stateFile), { recursive: true })
    await writeFile(this.#stateFile, `${JSON.stringify({ entries })}\n`)
  }

  #serial<T>(work: () => Promise<T>) {
    const result = this.#queue.then(work, work)
    this.#queue = result.catch(() => {})
    return result
  }
}
