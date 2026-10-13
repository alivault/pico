#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
if (args.includes("--help")) {
  console.log(`Pico — durable Pi sessions in your browser
Usage: pico-app [serve|status|stop|import-pi] [--port N] [--host H] [--data-dir D]
                 [--web-dir D] [--open|--no-open] [--wait] [--source-dir D]
The default address is 127.0.0.1:3141. Data is stored in ~/.pico.
Use a separate --data-dir for development.
Import old Pi sessions with import-pi while Pico is stopped.`)
  process.exit(0)
}
if (args.includes("--version")) {
  console.log(pkg.version)
  process.exit(0)
}
const [major, minor] = process.versions.node.split(".").map(Number)
if (major < 22 || (major === 22 && minor < 19))
  throw new Error("Pico requires Node.js 22.19 or later")
const command = args[0] && !args[0].startsWith("-") ? args.shift() : "serve"
const open =
  !args.includes("--no-open") &&
  process.env.PICO_OPEN !== "0" &&
  command === "serve"
const forwarded = args.filter((arg) => !["--open", "--no-open"].includes(arg))
const dataIndex = forwarded.indexOf("--data-dir")
const inlineData = forwarded
  .find((arg) => arg.startsWith("--data-dir="))
  ?.slice(11)
const dataDir = resolve(
  inlineData ??
    (dataIndex >= 0 ? forwarded[dataIndex + 1] : undefined) ??
    process.env.PICO_DATA_DIR ??
    join(homedir(), ".pico")
)
if (dataIndex < 0 && !inlineData) forwarded.push("--data-dir", dataDir)
if (
  command === "serve" &&
  !forwarded.some((arg) => arg.startsWith("--web-dir"))
) {
  forwarded.push(
    "--web-dir",
    process.env.PICO_WEB_DIR ?? join(root, ".output/public")
  )
}
const child = spawn(
  process.execPath,
  [
    "--enable-source-maps",
    join(root, "server/dist/pico-server.mjs"),
    command,
    ...forwarded,
  ],
  { stdio: "inherit" }
)
child.on("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal))
if (open) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const state = JSON.parse(
        readFileSync(join(dataDir, "server.json"), "utf8")
      )
      const host = ["0.0.0.0", "::"].includes(state.host)
        ? "localhost"
        : state.host
      const url = `http://${host.includes(":") ? `[${host}]` : host}:${state.port}`
      const response = await fetch(`${url}/api/system/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) {
        const [exe, options] =
          process.platform === "darwin"
            ? ["open", [url]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]]
        const browser = spawn(exe, options, { stdio: "ignore", detached: true })
        browser.on("error", () => console.log(`Open ${url} in your browser.`))
        browser.unref()
        break
      }
    } catch {
      /* Wait for the server. */
    }
    await new Promise((done) => setTimeout(done, 250))
  }
}
