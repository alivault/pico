import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"
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
  previewHttps,
  PreviewProxies,
  TailscalePreviewServe,
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
    const page = await fetch(`http://127.0.0.1:${proxy.port}/assets/app.js?q=1`)
    assert.equal(page.headers.get("cache-control"), "no-cache")
    const body = await page.text()
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

void test("a preview gets an HTTPS address through Tailscale Serve", async () => {
  const host = "box.tail1.ts.net"
  const web: Record<string, { Handlers: Record<string, { Proxy: string }> }> = {
    [`${host}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3141" } } },
    [`${host}:4341`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9" } } },
  }
  const calls: string[] = []
  const serve = new TailscalePreviewServe(async (args) => {
    calls.push(args.join(" "))
    if (args[1] === "status") return JSON.stringify({ Web: web })
    const port = /--https=(\d+)/.exec(args.join(" "))?.[1] ?? ""
    if (args.at(-1) === "off") delete web[`${host}:${port}`]
    else web[`${host}:${port}`] = { Handlers: { "/": { Proxy: args.at(-1)! } } }
    return ""
  })
  const app = createServer((_request, response) => response.end("ok"))
  const appPort = await listen(app)
  const proxies = new PreviewProxies(
    "127.0.0.1",
    () => ({ start: 4340, end: 4341 }),
    serve
  )
  const request = (hostHeader: string) =>
    ({ headers: { host: hostHeader } }) as never
  try {
    const proxy = await proxies.open(`http://localhost:${appPort}`, "s1")
    assert.deepEqual(
      await previewHttps(proxies, proxy.port, request("127.0.0.1:3141"), true),
      {
        httpsError:
          "Pico gives previews an HTTPS address only through Tailscale Serve",
      }
    )
    assert.deepEqual(
      await previewHttps(proxies, proxy.port, request(host), undefined),
      {}
    )
    const url = `https://${host}:${proxy.port}/`
    assert.deepEqual(
      await previewHttps(proxies, proxy.port, request(host), true),
      { httpsUrl: url }
    )
    assert.equal(await proxies.httpsUrl(proxy.port), url)
    assert.equal(
      calls.filter((call) => call.startsWith("serve --bg")).length,
      1,
      "Pico adds the Serve entry one time"
    )
    // Pico does not replace a Serve entry that is not its own.
    const other = await proxies.open("http://localhost:9", "s2")
    assert.equal(other.port, 4341)
    await assert.rejects(proxies.httpsUrl(other.port), /already uses port/)
  } finally {
    await proxies.shutdown()
    app.closeAllConnections()
    await new Promise((done) => app.close(done))
  }
  assert.ok(calls.includes(`serve --https=4340 off`))
  assert.ok(!calls.includes(`serve --https=4341 off`))
  assert.ok(web[`${host}:4341`], "the other entry stays")
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

void test(
  "an idle browser context closes, keeps its cookies, and Chrome closes after it",
  { skip: findChrome() ? false : "No Chrome on this machine" },
  async () => {
    const dir = await tempDir()
    const browser = new BrowserManager(dir, () => true, { idleMs: 60_000 })
    try {
      const session = await browser.session(8)
      await session.context.addCookies([
        { name: "kept", value: "yes", url: "http://127.0.0.1/" },
      ])
      await browser.session(9)
      assert.deepEqual(browser.stats, { contexts: 2, running: true })
      // Not idle yet: nothing closes.
      await browser.closeIdle(Date.now() + 1000)
      assert.equal(browser.stats.contexts, 2)
      await browser.closeIdle(Date.now() + 61_000)
      assert.deepEqual(browser.stats, { contexts: 0, running: false })
      const saved = JSON.parse(
        await readFile(join(dir, "browser", "8.json"), "utf8")
      ) as { cookies: Array<{ name: string }> }
      assert.ok(saved.cookies.some((cookie) => cookie.name === "kept"))
      // The next call opens Chrome and the context again, with the cookie.
      const reopened = await browser.session(8)
      const cookies = await reopened.context.cookies()
      assert.ok(cookies.some((cookie) => cookie.name === "kept"))
    } finally {
      await browser.shutdown()
    }
  }
)

void test("browser tabs and paths stay inside the data directory", () => {
  assert.ok(join("/data", "browser", "7.json").endsWith("browser/7.json"))
})
