import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { connect as netConnect, type AddressInfo } from "node:net"
import { test } from "node:test"

import { WebSocket, WebSocketServer } from "ws"

import type { MachineManager } from "../src/machines/manager.ts"
import { Security } from "../src/security.ts"
import {
  handlePreviewProxy,
  PREVIEW_PROXY_HEADER,
  PreviewProxy,
  previewProxyRoute,
  upgradePreviewProxy,
} from "../src/services/preview-proxy.ts"

const noMachines = { get: () => undefined } as unknown as MachineManager

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as AddressInfo).port
}

/** A dev server that echoes its request, with headers that block frames. */
async function devServer() {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, {
        location: `http://localhost:${port}/next?a=1`,
      })
      response.end()
      return
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'; img-src 'self'",
    })
    response.end(
      JSON.stringify({
        url: request.url,
        host: request.headers.host,
        origin: request.headers.origin ?? null,
      })
    )
  })
  const sockets = new WebSocketServer({ server })
  sockets.on("connection", (socket, request) => {
    socket.send(`hello ${request.url} ${request.headers.host}`)
  })
  const port = await listen(server)
  return { server, port }
}

void test("previewProxyRoute takes the port and the path", () => {
  assert.deepEqual(previewProxyRoute("/api/preview-proxy/5173/src/a.ts?x=1"), {
    port: 5173,
    path: "/src/a.ts?x=1",
  })
  assert.deepEqual(previewProxyRoute("/api/preview-proxy/3000"), {
    port: 3000,
    path: "/",
  })
  assert.equal(previewProxyRoute("/api/preview-proxy/0/"), undefined)
  assert.equal(previewProxyRoute("/api/preview-proxy/99999/"), undefined)
  assert.equal(previewProxyRoute("/api/preview/open"), undefined)
})

void test("a preview listener shows a local dev server on its own origin", async () => {
  const dev = await devServer()
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1")
  )
  try {
    const port = await previews.open("local", dev.port)
    assert.equal(await previews.open("local", dev.port), port)
    const origin = `http://127.0.0.1:${port}`

    const response = await fetch(`${origin}/src/main.ts?t=1`, {
      headers: { origin },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-frame-options"), null)
    assert.equal(
      response.headers.get("content-security-policy")?.trim(),
      "img-src 'self'"
    )
    assert.deepEqual(await response.json(), {
      url: "/src/main.ts?t=1",
      host: `localhost:${dev.port}`,
      origin: `http://localhost:${dev.port}`,
    })

    const redirect = await fetch(`${origin}/redirect`, { redirect: "manual" })
    assert.equal(redirect.headers.get("location"), "/next?a=1")

    // Another origin cannot use the preview.
    const crossOrigin = await fetch(`${origin}/`, {
      headers: { origin: "http://127.0.0.1:1" },
    })
    assert.equal(crossOrigin.status, 403)

    // Hot reload sockets go through.
    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/hmr?token=a`)
      socket.once("message", (data) => {
        resolve(Buffer.from(data as Buffer).toString("utf8"))
        socket.close()
      })
      socket.once("error", reject)
    })
    assert.equal(message, `hello /hmr?token=a localhost:${dev.port}`)
  } finally {
    await previews.close()
    dev.server.close()
  }
})

void test("a preview of a port with no server says so", async () => {
  const unused = createServer()
  const free = await listen(unused)
  await new Promise<void>((resolve) => unused.close(() => resolve()))
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1")
  )
  try {
    const port = await previews.open("local", free)
    const response = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(response.status, 502)
    assert.match(await response.text(), new RegExp(`port ${free}`))
  } finally {
    await previews.close()
  }
})

void test("the machine side of the preview proxy needs the hub header", async () => {
  const dev = await devServer()
  const machine = createServer((request, response) => {
    if (!handlePreviewProxy(request, response)) {
      response.writeHead(404)
      response.end()
    }
  })
  const machinePort = await listen(machine)
  try {
    const url = `http://127.0.0.1:${machinePort}/api/preview-proxy/${dev.port}/a?b=2`
    assert.equal((await fetch(url)).status, 403)
    const response = await fetch(url, {
      headers: { [PREVIEW_PROXY_HEADER]: "1" },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      url: "/a?b=2",
      host: `localhost:${dev.port}`,
      origin: null,
    })
  } finally {
    machine.close()
    dev.server.close()
  }
})

void test("a preview of a remote machine goes through its Pico server", async () => {
  const dev = await devServer()
  const remote = createServer((request, response) => {
    if (!handlePreviewProxy(request, response)) {
      response.writeHead(404)
      response.end()
    }
  })
  remote.on("upgrade", (request, socket, head) => {
    if (!upgradePreviewProxy(request, socket, head)) socket.destroy()
  })
  const remotePort = await listen(remote)
  const connection = {
    profile: { label: "remote" },
    endpoint: () => ({
      endpoint: { host: "127.0.0.1", port: remotePort },
      agent: false as const,
    }),
    socket: () => netConnect(remotePort, "127.0.0.1"),
  }
  const machines = {
    get: (id: string) => (id === "m_remote" ? connection : undefined),
  } as unknown as MachineManager
  const previews = new PreviewProxy(
    "127.0.0.1",
    machines,
    new Security("127.0.0.1")
  )
  try {
    const port = await previews.open("m_remote", dev.port)
    const origin = `http://127.0.0.1:${port}`
    const response = await fetch(`${origin}/src/app.ts`, {
      headers: { origin },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-frame-options"), null)
    assert.deepEqual(await response.json(), {
      url: "/src/app.ts",
      host: `localhost:${dev.port}`,
      origin: `http://localhost:${dev.port}`,
    })
    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=b`)
      socket.once("message", (data) => {
        resolve(Buffer.from(data as Buffer).toString("utf8"))
        socket.close()
      })
      socket.once("error", reject)
    })
    assert.equal(message, `hello /?token=b localhost:${dev.port}`)
  } finally {
    await previews.close()
    remote.close()
    dev.server.close()
  }
})

void test("a preview of an unknown machine fails", async () => {
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1")
  )
  await assert.rejects(previews.open("m_nope", 5173), /Unknown machine/)
})
