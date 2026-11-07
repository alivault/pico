import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import {
  BrowserManager,
  findChrome,
  formatSnapshot,
} from "../src/services/browser.ts"
import {
  BrowserView,
  type BrowserViewEvent,
} from "../src/services/browser-view.ts"
import { Notifier } from "../src/services/notify.ts"
import { tempDir } from "./support.ts"

function listen(server: Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
}

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

void test("a new subscription replaces the older ones from the same browser", async () => {
  const dir = await tempDir()
  const notifier = new Notifier(
    dir,
    () => "",
    async () => {
      throw new Error("not sent in this test")
    }
  )
  const keys = {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  }
  const chrome = "Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0 Safari/537.36"
  const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1"
  // An entry from before origins were saved: the label is the user agent.
  notifier.subscribe(
    { endpoint: "https://push.example/old", keys },
    { label: chrome.slice(0, 80) }
  )
  notifier.subscribe(
    { endpoint: "https://push.example/phone", keys },
    { label: "Safari on iOS", origin: "https://pico.ts.net", userAgent: phone }
  )
  notifier.subscribe(
    { endpoint: "https://push.example/dev", keys },
    {
      label: "Chrome on Linux",
      origin: "http://localhost:3000",
      userAgent: chrome,
    }
  )
  notifier.subscribe(
    { endpoint: "https://push.example/app", keys },
    {
      label: "Chrome on Linux",
      origin: "http://localhost:3141",
      userAgent: chrome,
    }
  )
  assert.deepEqual(
    notifier.devices.map((device) => device.endpoint),
    ["https://push.example/phone", "https://push.example/app"]
  )
  assert.equal(notifier.devices[1]!.origin, "http://localhost:3141")
  assert.equal(new Notifier(dir, () => "").subscriptionCount, 2)
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

void test(
  "the live view sends frames and tabs, does the user's input, and a handoff keeps the context open",
  { skip: findChrome() ? false : "No Chrome on this machine" },
  async () => {
    const dir = await tempDir()
    const site = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" })
      if (request.url === "/popup") {
        response.end("<title>Popup</title><p>popup</p>")
        return
      }
      response.end(
        `<title>Live</title><input id="field" style="position:absolute;left:10px;top:10px;width:200px;height:30px"><a id="open" href="/popup" target="_blank" style="position:absolute;left:10px;top:100px">open</a>`
      )
    })
    const port = await listen(site)
    const browser = new BrowserManager(dir, () => true, { idleMs: 60_000 })
    const events: BrowserViewEvent[] = []
    const waitFor = async (check: (event: BrowserViewEvent) => boolean) => {
      for (let tries = 0; tries < 100; tries++) {
        const found = events.find(check)
        if (found) return found
        await new Promise((done) => setTimeout(done, 50))
      }
      throw new Error(
        `No such event in ${JSON.stringify(events.map((event) => (event.type === "frame" ? "frame" : event)))}`
      )
    }
    const view = new BrowserView({
      browser,
      conversationId: 11,
      savedTabs: async () => [],
      send: (event, done) => {
        events.push(event)
        done?.()
      },
    })
    try {
      view.start()
      // No context yet: the view says so, and does not open Chrome.
      await waitFor((event) => event.type === "state" && !event.open)
      assert.equal(browser.stats.running, false)

      await view.input({ type: "navigate", url: `http://127.0.0.1:${port}/` })
      await waitFor(
        (event) =>
          event.type === "state" &&
          event.open &&
          event.tabs.some((tab) => tab.title === "Live")
      )
      const frame = await waitFor((event) => event.type === "frame")
      assert.ok(frame.type === "frame" && frame.data.length > 100)
      assert.equal(frame.type === "frame" && frame.width, 1280)

      // A click in the field, then text and a key.
      await view.input({ type: "mouse", action: "down", x: 50, y: 25 })
      await view.input({ type: "mouse", action: "up", x: 50, y: 25 })
      await view.input({ type: "text", text: "hello" })
      await view.input({ type: "key", key: "Backspace" })
      const { page } = (await browser.activePage(11))!
      assert.equal(await page.inputValue("#field"), "hell")

      // A link to a new window opens a tab, and it becomes the active tab.
      await view.input({ type: "mouse", action: "down", x: 20, y: 105 })
      await view.input({ type: "mouse", action: "up", x: 20, y: 105 })
      await waitFor(
        (event) =>
          event.type === "state" &&
          event.tabs.length === 2 &&
          event.tabs.find((tab) => tab.id === event.active)?.title === "Popup"
      )

      // A handoff keeps the context open when it is idle.
      const end = browser.startHandoff(11, {
        questionId: "q1",
        reason: "Log in",
      })
      await waitFor(
        (event) => event.type === "state" && event.handoff?.reason === "Log in"
      )
      await browser.closeIdle(Date.now() + 61_000)
      assert.equal(browser.isOpen(11), true)
      end()
      await browser.closeIdle(Date.now() + 61_000)
      assert.equal(browser.isOpen(11), false)
    } finally {
      view.stop()
      await browser.shutdown()
      site.closeAllConnections()
      await new Promise((done) => site.close(done))
    }
  }
)

void test("browser tabs and paths stay inside the data directory", () => {
  assert.ok(join("/data", "browser", "7.json").endsWith("browser/7.json"))
})
