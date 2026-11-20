/**
 * The way from a hub to the Pico server of a remote machine. Version 1 has
 * only SSH (`ssh.ts`). A later transport, for example direct HTTP over the
 * tailnet, can use the same interface.
 */
import type { Agent } from "node:http"

export type ExecResult = { code: number; stdout: string; stderr: string }

/** Where HTTP requests to the remote server go. */
export type Endpoint = { socketPath: string } | { host: string; port: number }

export interface MachineTransport {
  /** Start or check the connection. Never asks the user for input. */
  connect(signal: AbortSignal): Promise<void>
  /** Run a command on the remote host (setup and status only). */
  exec(
    argv: string[],
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<ExecResult>
  /** Send requests to this port of the remote host's loopback. */
  attach(remotePort: number): Promise<void>
  /** The local end for HTTP, SSE, and WebSocket requests. */
  endpoint(): Endpoint
  /** An agent for HTTP and SSE requests to the remote server. */
  agent(): Agent
  /** Close the connection. With `exit`, also stop the shared SSH connection. */
  close(options?: { exit?: boolean }): Promise<void>
}

/** A failed SSH or remote command, with the last lines of its errors. */
export class TransportError extends Error {
  readonly code: number
  readonly stderr: string
  constructor(message: string, code: number, stderr: string) {
    super(message)
    this.code = code
    this.stderr = stderr
  }
}

/** Quote one argument for a POSIX shell and for fish. */
export function shellQuote(value: string) {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** The last lines of command errors, for a notice. */
export function lastLines(text: string, count = 6) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-count)
    .join("\n")
}
