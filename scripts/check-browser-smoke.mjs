#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const url = process.env.PICO_SMOKE_URL ?? "http://127.0.0.1:3141/"
const chromeBinary =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if (!existsSync(chromeBinary)) {
  throw new Error(`Chrome was not found at ${chromeBinary}`)
}

const profile = mkdtempSync(join(tmpdir(), "pico-browser-smoke-"))
const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--disable-background-networking",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
)

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function devtoolsPort() {
  const path = join(profile, "DevToolsActivePort")
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      const port = Number(readFileSync(path, "utf8").split("\n")[0])
      if (Number.isInteger(port) && port > 0) return port
    }
    await sleep(50)
  }
  throw new Error("Chrome DevTools did not become ready")
}

let socket
try {
  const port = await devtoolsPort()
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.json()
  )
  const target = targets.find((candidate) => candidate.type === "page")
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Chrome did not expose a page target")
  }

  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const handler = pending.get(message.id)
    if (!handler) return
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(message.error.message))
    else handler.resolve(message.result)
  })
  function command(method, params = {}) {
    const id = nextId
    nextId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  await command("Page.enable")
  await command("Runtime.enable")
  await command("Page.navigate", { url })

  let snapshot
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await command("Runtime.evaluate", {
      expression: `({
        readyState: document.readyState,
        title: document.title,
        appChildren: document.querySelector("#app")?.childElementCount ?? 0,
        bodyText: document.body?.innerText ?? ""
      })`,
      returnByValue: true,
    })
    snapshot = result.result.value
    if (
      snapshot?.readyState === "complete" &&
      snapshot.title === "Pico" &&
      snapshot.appChildren > 0 &&
      snapshot.bodyText.length > 20
    ) {
      break
    }
    await sleep(100)
  }

  if (
    snapshot?.title !== "Pico" ||
    snapshot.appChildren < 1 ||
    snapshot.bodyText.length <= 20
  ) {
    throw new Error(
      `Pico browser shell did not render: ${JSON.stringify(snapshot)}`
    )
  }
  console.log(
    `Browser smoke passed (${snapshot.appChildren} app roots, ${snapshot.bodyText.length} visible characters).`
  )
  await command("Browser.close")
} finally {
  socket?.close()
  if (chrome.exitCode === null) chrome.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    sleep(2_000),
  ])
  spawnSync("trash", [profile], { stdio: "ignore" })
}
