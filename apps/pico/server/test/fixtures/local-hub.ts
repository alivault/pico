/**
 * A hub for tests: a normal Pico server whose machines use a transport to a
 * Pico on this computer instead of SSH. The test bundles and runs it.
 *
 *   node local-hub.mjs <data-dir> <remote-port>
 */
import { writeFileSync } from "node:fs"
import { Agent } from "node:http"
import { join } from "node:path"

import { serverPaths } from "../../src/config.ts"
import type {
  ExecResult,
  MachineTransport,
} from "../../src/machines/transport.ts"
import { startServer } from "../../src/server.ts"

/** No SSH; the same protocol to a server on this computer. */
class LocalTransport implements MachineTransport {
  readonly #port: number
  readonly #agent = new Agent({ keepAlive: true })
  constructor(port: number) {
    this.#port = port
  }
  async connect() {}
  async exec(argv: string[]): Promise<ExecResult> {
    if (argv[0] === "sh")
      return {
        code: 0,
        stdout: "os=Test\nnode=/usr/bin v24.0.0\npico=/bin/pico-app\n",
        stderr: "",
      }
    if (argv.includes("status")) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${this.#port}/api/system/health`
        )
        await response.body?.cancel()
        return {
          code: 0,
          stdout: JSON.stringify({
            pid: 1,
            port: this.#port,
            host: "127.0.0.1",
            version: "test",
          }),
          stderr: "",
        }
      } catch {
        return { code: 1, stdout: "", stderr: "Pico is not running." }
      }
    }
    return { code: 127, stdout: "", stderr: "unknown command" }
  }
  async attach() {}
  endpoint() {
    return { host: "127.0.0.1", port: this.#port }
  }
  agent() {
    return this.#agent
  }
  async forward(remotePort: number) {
    return { localPort: remotePort, close: async () => undefined }
  }
  async close() {
    this.#agent.destroy()
  }
}

const [dataDir, remotePort] = process.argv.slice(2)
const server = await startServer({
  paths: serverPaths(dataDir!),
  host: "127.0.0.1",
  port: 0,
  machineTransport: () => new LocalTransport(Number(remotePort)),
})
writeFileSync(
  join(dataDir!, "server.json"),
  JSON.stringify({ port: server.port() })
)
process.on("SIGTERM", () => {
  void server.shutdown().then(() => process.exit(0))
})
