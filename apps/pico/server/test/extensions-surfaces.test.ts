import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { test } from "node:test"

import { WebSocket, WebSocketServer } from "ws"

import {
  BrowserManager,
  findChrome,
  formatSnapshot,
} from "../src/services/browser.ts"
import { Notifier } from "../src/services/notify.ts"
import {
  localTarget,
  parsePortRange,
  PreviewProxies,
  waitForUrl,
} from "../src/services/preview.ts"
import { tempDir } from "./support.ts"

function listen(server: Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
}

void test("preview targets must be local", () => {
  assert.equal(localTarget("localhost:5173").origin, "http://localhost:5173")
  assert.equal(
    localTarget("http://0.0.0.0:3000").origin,
    "http://127.0.0.1:3000"
  )
  assert.throws(() => localTarget("https://example.com"), /Only local/)
  assert.deepEqual(parsePortRange("5000-5009"), { start: 5000, end: 5009 })
  assert.deepEqual(parsePortRange("nonsense"), { start: 4100, end: 4199 })
})

void test("a preview proxy forwards HTTP and WebSockets at the root path", async () => {
  const app = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(
      `<script src="/assets/app.js"></script> path=${request.url} host=${request.headers.host}`
    )
  })
  const sockets = new WebSocketServer({ server: app })
  sockets.on("connection", (socket) => {
    socket.on("message", (data: Buffer) =>
      socket.send(`echo:${data.toString()}`)
    )
  })
  const appPort = await listen(app)
  const proxies = new PreviewProxies("127.0.0.1", () => ({
    start: 4310,
    end: 4330,
  }))
  try {
    await waitForUrl(`http://127.0.0.1:${appPort}`, 5000)
    const proxy = await proxies.open(`http://localhost:${appPort}`, "s1")
    assert.ok(proxy.port >= 4310 && proxy.port <= 4330)
    assert.equal(
      (await proxies.open(`http://localhost:${appPort}/x`, "s1")).port,
      proxy.port
    )
    const body = await (
      await fetch(`http://127.0.0.1:${proxy.port}/assets/app.js?q=1`)
    ).text()
    assert.match(body, /path=\/assets\/app\.js\?q=1/)
    assert.match(body, new RegExp(`host=localhost:${appPort}`))
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${proxy.port}/hmr`)
      socket.on("open", () => socket.send("hi"))
      socket.on("message", (data: Buffer) => {
        resolve(data.toString())
        socket.close()
      })
      socket.on("error", reject)
    })
    assert.equal(reply, "echo:hi")
  } finally {
    await proxies.shutdown()
    sockets.close()
    app.closeAllConnections()
    await new Promise((done) => app.close(done))
  }
})

void test("notifications keep keys, drop gone devices, and post to ntfy", async () => {
  const dir = await tempDir()
  let ntfy: { title?: string; body: string } | undefined
  let pushes = 0
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      if (request.url === "/topic") {
        ntfy = { title: request.headers.title as string, body }
        response.end("ok")
      } else {
        pushes += 1
        response.writeHead(410)
        response.end()
      }
    })
  })
  const port = await listen(server)
  try {
    const sent: Array<{ endpoint: string; payload: string }> = []
    const notifier = new Notifier(
      dir,
      () => `http://127.0.0.1:${port}/topic`,
      async (subscription, payload) => {
        sent.push({ endpoint: subscription.endpoint, payload: String(payload) })
        pushes += 1
        throw Object.assign(new Error("Gone"), { statusCode: 410 })
      }
    )
    const key = notifier.publicKey
    assert.equal(new Notifier(dir, () => "").publicKey, key)
    notifier.subscribe({
      endpoint: "https://push.example/abc",
      keys: {
        p256dh:
          "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    })
    assert.equal(notifier.subscriptionCount, 1)
    const delivered = await notifier.send({
      title: "Done",
      body: "The run finished",
    })
    assert.equal(delivered, 1)
    assert.equal(pushes, 1)
    assert.deepEqual(JSON.parse(sent[0]!.payload), {
      title: "Done",
      body: "The run finished",
    })
    assert.equal(notifier.subscriptionCount, 0)
    assert.deepEqual(ntfy, { title: "Done", body: "The run finished" })
  } finally {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
})

void test(
  "the durable browser reads, acts, and keeps cookies across restarts",
  { skip: findChrome() ? false : "No Chrome on this machine" },
  async () => {
    const dir = await tempDir()
    const site = createServer((request, response) => {
      if (request.url?.startsWith("/login")) {
        response.writeHead(302, {
          "set-cookie": "session=abc; Path=/; Max-Age=3600",
          location: "/",
        })
        response.end()
        return
      }
      const cookie = request.headers.cookie ?? "none"
      response.writeHead(200, { "content-type": "text/html" })
      response.end(
        `<title>Demo</title><h1>Welcome</h1><p>cookie=${cookie}</p><form action="/login"><input name="user" placeholder="User name"><button>Sign in</button></form>`
      )
    })
    const port = await listen(site)
    let browser = new BrowserManager(dir, () => true)
    try {
      const { page } = await browser.open(
        7,
        [],
        `http://127.0.0.1:${port}/`,
        false
      )
      const snapshot = await browser.snapshot(page)
      assert.match(formatSnapshot(snapshot), /\[1\] input:text "User name"/)
      assert.match(formatSnapshot(snapshot), /\[2\] button "Sign in"/)
      await page.locator('[data-pico-ref="1"]').fill("ann")
      await page.locator('[data-pico-ref="2"]').click()
      await page.waitForLoadState("domcontentloaded")
      assert.match((await browser.snapshot(page)).text, /cookie=session=abc/)
      const tabs = (await browser.tabs(7)).tabs
      await browser.shutdown()

      browser = new BrowserManager(dir, () => true)
      await browser.session(7, tabs)
      const reopened = await browser.page(7, tabs)
      await reopened.page.reload()
      assert.match(
        (await browser.snapshot(reopened.page)).text,
        /cookie=session=abc/
      )
    } finally {
      await browser.shutdown()
      site.closeAllConnections()
      await new Promise((done) => site.close(done))
    }
  }
)

void test("browser tabs and paths stay inside the data directory", () => {
  assert.ok(join("/data", "browser", "7.json").endsWith("browser/7.json"))
})
