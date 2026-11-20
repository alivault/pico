import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { WebSocket, WebSocketServer } from "ws"

import type { MachineManager } from "../src/machines/manager.ts"
import { Security } from "../src/security.ts"
import {
  PreviewProxy,
  TailscalePreviewError,
} from "../src/services/preview-proxy.ts"
import {
  serveTarget,
  TailscaleServe,
  tailscaleHttpsHost,
} from "../src/services/tailscale-serve.ts"

const HOST = "box.tail1.ts.net"
const noMachines = { get: () => undefined } as unknown as MachineManager

/** A fake tailscale CLI with one Serve config, as `serve status --json`. */
function fakeTailscale(
  initial: Record<number, string> = { 443: "http://127.0.0.1:3141" }
) {
  const entries = new Map(
    Object.entries(initial).map(([port, target]) => [Number(port), target])
  )
  const calls: string[] = []
  let failure: string | undefined
  const run = (args: string[]) => {
    calls.push(args.join(" "))
    if (failure) return Promise.reject(new Error(failure))
    const [, first, second, third] = args
    if (first === "status") {
      const ports = [...entries]
      return Promise.resolve(
        JSON.stringify({
          TCP: Object.fromEntries(
            ports.map(([port]) => [port, { HTTPS: true }])
          ),
          Web: Object.fromEntries(
            ports.map(([port, target]) => [
              `${HOST}:${port}`,
              { Handlers: { "/": { Proxy: target } } },
            ])
          ),
        })
      )
    }
    if (first === "--bg") {
      entries.set(Number(second!.slice("--https=".length)), third!)
      return Promise.resolve("")
    }
    const port = Number(first!.slice("--https=".length))
    if (second === "off" && entries.delete(port)) return Promise.resolve("")
    return Promise.reject(new Error("handler does not exist"))
  }
  return {
    run,
    calls,
    entries,
    fail: (message: string | undefined) => (failure = message),
    changes: () => calls.filter((call) => !call.includes("status")),
  }
}

async function stateFile() {
  return join(await mkdtemp(join(tmpdir(), "pico-ts-serve-")), "serve.json")
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as AddressInfo).port
}

void test("tailscaleHttpsHost finds requests through Tailscale Serve over HTTPS", () => {
  // The headers that Tailscale Serve 1.104 sends.
  assert.equal(
    tailscaleHttpsHost({
      host: `${HOST}`,
      "x-forwarded-host": `${HOST}`,
      "x-forwarded-proto": "https",
      "tailscale-headers-info": "https://tailscale.com/s/serve-headers",
      "tailscale-user-login": "ali@github",
    }),
    HOST
  )
  assert.equal(
    tailscaleHttpsHost({ host: `${HOST}:8443`, "x-forwarded-proto": "https" }),
    HOST
  )
  assert.equal(
    tailscaleHttpsHost({
      host: "pico.example.com",
      "x-forwarded-proto": "https",
      "tailscale-headers-info": "https://tailscale.com/s/serve-headers",
    }),
    "pico.example.com"
  )
  // Plain HTTP, also on a Tailscale name, keeps the plain listener.
  assert.equal(tailscaleHttpsHost({ host: `${HOST}:3141` }), undefined)
  assert.equal(
    tailscaleHttpsHost({ host: HOST, "x-forwarded-proto": "http" }),
    undefined
  )
  assert.equal(tailscaleHttpsHost({ host: "127.0.0.1:3141" }), undefined)
  // Another HTTPS proxy is not Tailscale Serve.
  assert.equal(
    tailscaleHttpsHost({
      host: "pico.example.com",
      "x-forwarded-proto": "https",
    }),
    undefined
  )
})

void test("serveTarget proxies to the address of the listener", () => {
  assert.equal(serveTarget("127.0.0.1", 50876), "http://127.0.0.1:50876")
  assert.equal(serveTarget("0.0.0.0", 50876), "http://127.0.0.1:50876")
  assert.equal(serveTarget("::1", 50876), "http://[::1]:50876")
  assert.equal(serveTarget("100.64.0.1", 50876), "http://100.64.0.1:50876")
})

void test("TailscaleServe adds and removes only its own entries", async () => {
  const tailscale = fakeTailscale({
    443: "http://127.0.0.1:3141",
    50000: "http://127.0.0.1:9999",
  })
  const file = await stateFile()
  const serve = new TailscaleServe(file, tailscale.run)

  assert.equal(await serve.add(50876, "http://127.0.0.1:50876"), 50876)
  assert.equal(await serve.add(50876, "http://127.0.0.1:50876"), 50876)
  // The user's entry on the port stays; Pico takes the next free port.
  assert.equal(await serve.add(50000, "http://127.0.0.1:50000"), 50001)
  assert.deepEqual(tailscale.changes(), [
    "serve --bg --https=50876 http://127.0.0.1:50876",
    "serve --bg --https=50001 http://127.0.0.1:50000",
  ])
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    entries: [
      { port: 50876, target: "http://127.0.0.1:50876" },
      { port: 50001, target: "http://127.0.0.1:50000" },
    ],
  })

  // The user changed this entry: it is no longer Pico's.
  tailscale.entries.set(50001, "http://127.0.0.1:7777")
  await serve.remove(50876)
  await serve.remove(50001)
  // Not an entry of Pico.
  await serve.remove(443)
  assert.deepEqual(tailscale.changes().slice(2), ["serve --https=50876 off"])
  assert.deepEqual([...tailscale.entries.keys()], [443, 50000, 50001])
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { entries: [] })
})

void test("TailscaleServe removes the unchanged entries of an earlier run at start", async () => {
  const tailscale = fakeTailscale({
    443: "http://127.0.0.1:3141",
    51000: "http://127.0.0.1:51000",
    51001: "http://127.0.0.1:8080",
  })
  const file = await stateFile()
  await writeFile(
    file,
    JSON.stringify({
      entries: [
        { port: 51000, target: "http://127.0.0.1:51000" },
        // The user changed it since.
        { port: 51001, target: "http://127.0.0.1:51001" },
        // Gone already.
        { port: 51002, target: "http://127.0.0.1:51002" },
      ],
    })
  )
  const serve = new TailscaleServe(file, tailscale.run)
  await serve.ready()
  assert.deepEqual(tailscale.changes(), ["serve --https=51000 off"])
  assert.deepEqual([...tailscale.entries.keys()], [443, 51001])
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { entries: [] })
})

void test("TailscaleServe keeps the records when the CLI fails at start", async () => {
  const tailscale = fakeTailscale()
  tailscale.fail("The tailscale command is not installed")
  const file = await stateFile()
  const stale = { port: 51000, target: "http://127.0.0.1:51000" }
  await writeFile(file, JSON.stringify({ entries: [stale] }))
  const serve = new TailscaleServe(file, tailscale.run)
  await serve.ready()
  tailscale.fail(undefined)
  await serve.add(52000, "http://127.0.0.1:52000")
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    entries: [stale, { port: 52000, target: "http://127.0.0.1:52000" }],
  })
})

void test("TailscaleServe does not run tailscale at start without records", async () => {
  const tailscale = fakeTailscale()
  const serve = new TailscaleServe(await stateFile(), tailscale.run)
  await serve.ready()
  assert.deepEqual(tailscale.calls, [])
})

void test("a preview over Tailscale HTTPS gets a Serve entry on its port", async () => {
  const dev = createServer((request, response) => {
    response.end(`${request.url} ${request.headers.host}`)
  })
  const sockets = new WebSocketServer({ server: dev })
  sockets.on("connection", (socket, request) =>
    socket.send(`hello ${request.url}`)
  )
  const devPort = await listen(dev)
  const tailscale = fakeTailscale()
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1"),
    new TailscaleServe(await stateFile(), tailscale.run)
  )
  try {
    const plain = await previews.open("local", devPort)
    assert.equal(plain.url, undefined)
    assert.deepEqual(tailscale.calls, [])

    const opened = await previews.open("local", devPort, HOST)
    assert.equal(opened.port, plain.port)
    assert.equal(opened.url, `https://${HOST}:${opened.port}`)
    assert.equal(
      tailscale.entries.get(opened.port),
      `http://127.0.0.1:${opened.port}`
    )
    // The second open uses the same entry.
    await previews.open("local", devPort, HOST)
    assert.equal(tailscale.changes().length, 1)

    // As Tailscale Serve sends it: the MagicDNS host and an HTTPS origin.
    const origin = `https://${HOST}:${opened.port}`
    // fetch() cannot set the Host header.
    const text = await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: opened.port,
          path: "/app",
          headers: { host: `${HOST}:${opened.port}`, origin },
        },
        (response) => {
          let body = ""
          response.setEncoding("utf8")
          response.on("data", (chunk: string) => (body += chunk))
          response.on("end", () => resolve(body))
        }
      )
      request.on("error", reject)
      request.end()
    })
    assert.equal(text, `/app localhost:${devPort}`)
    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${opened.port}/hmr`, {
        headers: { host: `${HOST}:${opened.port}` },
        origin,
      })
      socket.once("message", (data) => {
        resolve(Buffer.from(data as Buffer).toString("utf8"))
        socket.close()
      })
      socket.once("error", reject)
    })
    assert.equal(message, "hello /hmr")
  } finally {
    await previews.close()
    dev.close()
  }
  // Closing removes the entry, and only it.
  assert.deepEqual([...tailscale.entries.keys()], [443])
})

void test("a preview over Tailscale HTTPS says when tailscale serve fails", async () => {
  const dev = createServer((_request, response) => response.end("ok"))
  const devPort = await listen(dev)
  const tailscale = fakeTailscale()
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1"),
    new TailscaleServe(await stateFile(), tailscale.run)
  )
  try {
    tailscale.fail("The tailscale command is not installed")
    await assert.rejects(
      previews.open("local", devPort, HOST),
      (error: Error) =>
        error instanceof TailscalePreviewError &&
        /tailscale serve failed \(The tailscale command is not installed\)/.test(
          error.message
        )
    )
    // It tries again on the next open.
    tailscale.fail(undefined)
    const opened = await previews.open("local", devPort, HOST)
    assert.equal(opened.url, `https://${HOST}:${opened.port}`)
  } finally {
    await previews.close()
    dev.close()
  }
})
