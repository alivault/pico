import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"
import { Script } from "node:vm"
import { brotliCompressSync, deflateRawSync, gzipSync } from "node:zlib"

import { WebSocket, WebSocketServer } from "ws"

import type { MachineManager } from "../src/machines/manager.ts"
import { Security } from "../src/security.ts"
import {
  allowPreviewScript,
  injectPreviewScript,
  PREVIEW_BACKGROUND_SCRIPT,
} from "../src/services/preview-background.ts"
import { PreviewProxy } from "../src/services/preview-proxy.ts"

const noMachines = { get: () => undefined } as unknown as MachineManager
const TAG = `<script data-smith-preview>${PREVIEW_BACKGROUND_SCRIPT}</script>`
const HASH = `'sha256-${createHash("sha256").update(PREVIEW_BACKGROUND_SCRIPT).digest("base64")}'`

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as AddressInfo).port
}

const DARK_PAGE =
  '<!doctype html><HTML><HEAD lang="en"><style>html{background:#111}</style></HEAD><body>Hi</body></HTML>'

/** A dev server with pages in different forms. */
async function devServer() {
  const server = createServer((request, response) => {
    const html = { "content-type": "text/html; charset=utf-8" }
    switch (request.url) {
      case "/plain":
        response.writeHead(200, html)
        response.end("<html><head><title>a</title></head><body></body></html>")
        return
      case "/upper":
        response.writeHead(200, html)
        response.end(DARK_PAGE)
        return
      case "/no-head":
        response.writeHead(200, html)
        response.end("<!DOCTYPE html>\n<p>no head</p>")
        return
      case "/gzip":
        response.writeHead(200, {
          ...html,
          "content-encoding": "gzip",
          etag: '"abc"',
        })
        response.end(gzipSync(DARK_PAGE))
        return
      case "/br":
        response.writeHead(200, { ...html, "content-encoding": "br" })
        response.end(brotliCompressSync(DARK_PAGE))
        return
      case "/deflate-raw":
        response.writeHead(200, { ...html, "content-encoding": "deflate" })
        response.end(deflateRawSync(DARK_PAGE))
        return
      case "/csp":
        response.writeHead(200, {
          ...html,
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'nonce-abc'; frame-ancestors 'none'",
        })
        response.end(DARK_PAGE)
        return
      case "/stream": {
        // The head comes in two chunks; the rest comes later.
        response.writeHead(200, html)
        response.write("<!doctype html><he")
        setTimeout(() => {
          response.write('ad class="x"><title>t</title>')
          setTimeout(() => response.end("</head><body>end</body>"), 20)
        }, 20)
        return
      }
      case "/missing":
        response.writeHead(404, html)
        response.end("<html><head></head></html>")
        return
      case "/script.js":
        response.writeHead(200, { "content-type": "text/javascript" })
        response.end("console.log('<head>')")
        return
      default:
        response.writeHead(404)
        response.end()
    }
  })
  const sockets = new WebSocketServer({ server })
  sockets.on("connection", (socket, request) => {
    socket.send(`hello ${request.url}`)
  })
  return { server, port: await listen(server) }
}

async function withPreview(
  run: (origin: string, port: number) => Promise<void>
) {
  const dev = await devServer()
  const previews = new PreviewProxy(
    "127.0.0.1",
    noMachines,
    new Security("127.0.0.1")
  )
  try {
    const { port } = await previews.open("local", dev.port)
    await run(`http://127.0.0.1:${port}`, port)
  } finally {
    await previews.close()
    dev.server.close()
  }
}

void test("injectPreviewScript puts the script after the head tag", () => {
  assert.equal(
    injectPreviewScript(Buffer.from("<html><head><b>")).toString(),
    `<html><head>${TAG}<b>`
  )
  assert.equal(
    injectPreviewScript(Buffer.from('<HEAD lang="en">x')).toString(),
    `<HEAD lang="en">${TAG}x`
  )
  // Not <header>.
  assert.equal(
    injectPreviewScript(Buffer.from("<html lang=en><header>")).toString(),
    `<html lang=en>${TAG}<header>`
  )
  // After the doctype, so the page does not go into quirks mode.
  assert.equal(
    injectPreviewScript(Buffer.from("<!doctype html><p>")).toString(),
    `<!doctype html>${TAG}<p>`
  )
  assert.equal(
    injectPreviewScript(Buffer.from("<p>x")).toString(),
    `${TAG}<p>x`
  )
  // The bytes of other characters stay as they are.
  const latin = Buffer.from([0x3c, 0x70, 0x3e, 0xe9])
  assert.deepEqual(
    injectPreviewScript(latin),
    Buffer.concat([Buffer.from(TAG), latin])
  )
})

void test("allowPreviewScript adds the script hash to the policy", () => {
  assert.equal(
    allowPreviewScript("default-src 'self'; img-src *"),
    `default-src 'self' ${HASH}; img-src *`
  )
  assert.equal(
    allowPreviewScript("default-src 'self'; script-src 'nonce-a'"),
    `default-src 'self'; script-src 'nonce-a' ${HASH}`
  )
  assert.equal(allowPreviewScript("script-src 'none'"), `script-src ${HASH}`)
  // 'unsafe-inline' already allows it; a hash would turn it off.
  assert.equal(
    allowPreviewScript("script-src 'self' 'unsafe-inline'"),
    "script-src 'self' 'unsafe-inline'"
  )
  assert.equal(allowPreviewScript("img-src *"), "img-src *")
  assert.equal(
    allowPreviewScript("script-src 'self', default-src 'none'"),
    `script-src 'self' ${HASH}, default-src ${HASH}`
  )
})

void test("the preview puts the background script in HTML pages", async () => {
  await withPreview(async (origin) => {
    const plain = await fetch(`${origin}/plain`)
    assert.equal(
      await plain.text(),
      `<html><head>${TAG}<title>a</title></head><body></body></html>`
    )

    const upper = await (await fetch(`${origin}/upper`)).text()
    assert.equal(upper, DARK_PAGE.replace('<HEAD lang="en">', `$&${TAG}`))

    assert.equal(
      await (await fetch(`${origin}/no-head`)).text(),
      `<!DOCTYPE html>${TAG}\n<p>no head</p>`
    )

    const stream = await fetch(`${origin}/stream`)
    assert.equal(
      await stream.text(),
      `<!doctype html><head class="x">${TAG}<title>t</title></head><body>end</body>`
    )
  })
})

void test("the preview decompresses gzip, br, and deflate pages", async () => {
  await withPreview(async (origin) => {
    const expected = DARK_PAGE.replace('<HEAD lang="en">', `$&${TAG}`)
    for (const path of ["/gzip", "/br", "/deflate-raw"]) {
      const response = await fetch(`${origin}${path}`, {
        headers: { "accept-encoding": "gzip, br, deflate" },
      })
      assert.equal(response.headers.get("content-encoding"), null, path)
      assert.equal(await response.text(), expected, path)
    }
    const gzip = await fetch(`${origin}/gzip`)
    assert.equal(gzip.headers.get("etag"), 'W/"abc"')
  })
})

void test("the preview adds the script hash to the page's policy", async () => {
  await withPreview(async (origin) => {
    const response = await fetch(`${origin}/csp`)
    assert.equal(
      response.headers.get("content-security-policy"),
      `default-src 'self'; script-src 'self' 'nonce-abc' ${HASH}`
    )
    assert.match(await response.text(), /data-smith-preview/)
  })
})

void test("the preview sends other replies as they are", async () => {
  await withPreview(async (origin, port) => {
    const script = await fetch(`${origin}/script.js`)
    assert.equal(await script.text(), "console.log('<head>')")

    const missing = await fetch(`${origin}/missing`)
    assert.equal(missing.status, 404)
    assert.equal(await missing.text(), "<html><head></head></html>")

    const head = await fetch(`${origin}/plain`, { method: "HEAD" })
    assert.equal(head.status, 200)

    // A fetch of an HTML fragment is not a page.
    const fragment = await fetch(`${origin}/plain`, {
      headers: { "sec-fetch-dest": "empty" },
    })
    assert.doesNotMatch(await fragment.text(), /data-smith-preview/)
    const frame = await fetch(`${origin}/plain`, {
      headers: { "sec-fetch-dest": "iframe" },
    })
    assert.match(await frame.text(), /data-smith-preview/)

    // Hot reload sockets still go through.
    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/hmr`)
      socket.once("message", (data) => {
        resolve(Buffer.from(data as Buffer).toString("utf8"))
        socket.close()
      })
      socket.once("error", reject)
    })
    assert.equal(message, "hello /hmr")
  })
})

void test("the background script parses", () => {
  // Compiles the script without running it.
  assert.doesNotThrow(() => new Script(PREVIEW_BACKGROUND_SCRIPT))
})

void test("the CSP hash is the hash of the current script", () => {
  const policy = allowPreviewScript("script-src 'self'")
  const hash = createHash("sha256")
    .update(PREVIEW_BACKGROUND_SCRIPT, "utf8")
    .digest("base64")
  assert.equal(policy, `script-src 'self' 'sha256-${hash}'`)
  assert.match(PREVIEW_BACKGROUND_SCRIPT, /smith-preview-location/)
  assert.match(PREVIEW_BACKGROUND_SCRIPT, /smith-preview-command/)
})

/** Run the script in a fake frame. */
function runInFakeFrame(options: { navigation?: boolean } = {}) {
  type Listener = (event: Record<string, unknown>) => void
  const listeners = new Map<string, Listener[]>()
  const posted: Array<Record<string, unknown>> = []
  const calls: string[] = []
  const parent = {
    postMessage: (message: Record<string, unknown>) => posted.push(message),
  }
  const location = {
    href: "http://127.0.0.1:4000/",
    origin: "http://127.0.0.1:4000",
    replace: (url: string) => calls.push(`location.replace ${url}`),
  }
  const history = {
    pushState: (_: unknown, __: string, url: string) => {
      location.href = new URL(url, location.href).href
    },
    replaceState: (_: unknown, __: string, url: string) => {
      location.href = new URL(url, location.href).href
    },
    back: () => calls.push("history.back"),
    forward: () => calls.push("history.forward"),
  }
  const settled = { committed: Promise.resolve(), finished: Promise.resolve() }
  const navigation = {
    canGoBack: true,
    canGoForward: false,
    back: () => (calls.push("navigation.back"), settled),
    forward: () => (calls.push("navigation.forward"), settled),
  }
  const element = { style: {} }
  const window: Record<string, unknown> = {
    parent,
    location,
    history,
    ...(options.navigation ? { navigation } : {}),
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  }
  const context = {
    window,
    location,
    history,
    document: {
      documentElement: element,
      head: element,
      body: element,
      addEventListener: () => {},
      querySelector: () => null,
    },
    getComputedStyle: () => ({ backgroundColor: "", colorScheme: "" }),
    MutationObserver: class {
      observe() {}
    },
    setTimeout,
    URL,
  }
  new Script(PREVIEW_BACKGROUND_SCRIPT).runInNewContext(context)
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return { posted, calls, history, location, parent, navigation, fire }
}

void test("the script reports the location and takes commands", () => {
  const frame = runInFakeFrame()
  const locations = () =>
    frame.posted
      .filter((message) => message.type === "smith-preview-location")
      .map((message) => `${String(message.kind)} ${String(message.href)}`)
  assert.deepEqual(locations(), ["load http://127.0.0.1:4000/"])
  frame.history.pushState(null, "", "/settings")
  frame.history.replaceState(null, "", "/settings?tab=a")
  // The same address again: no message.
  frame.history.replaceState(null, "", "/settings?tab=a")
  frame.location.href = "http://127.0.0.1:4000/#top"
  frame.fire("hashchange")
  assert.deepEqual(locations(), [
    "load http://127.0.0.1:4000/",
    "push http://127.0.0.1:4000/settings",
    "replace http://127.0.0.1:4000/settings?tab=a",
    "pop http://127.0.0.1:4000/#top",
  ])

  const command = (
    action: string,
    href: unknown,
    source: unknown = frame.parent
  ) =>
    frame.fire("message", {
      source,
      data: { type: "smith-preview-command", action, href },
    })
  // Without the Navigation API, the page loads the address in place.
  command("back", "http://127.0.0.1:4000/settings")
  command("forward", "/about")
  // Not from the parent, another origin, no address, the page's own
  // address, or another action: nothing.
  command("back", "http://127.0.0.1:4000/x", {})
  command("back", "http://evil.example/")
  command("back", undefined)
  command("back", "http://127.0.0.1:4000/#top")
  command("reload", "http://127.0.0.1:4000/x")
  frame.fire("message", { source: frame.parent, data: null })
  assert.deepEqual(frame.calls, [
    "location.replace http://127.0.0.1:4000/settings",
    "location.replace http://127.0.0.1:4000/about",
  ])
})

void test("the script uses the Navigation API when there is one", () => {
  const frame = runInFakeFrame({ navigation: true })
  const command = (action: string) =>
    frame.fire("message", {
      source: frame.parent,
      data: {
        type: "smith-preview-command",
        action,
        href: "http://127.0.0.1:4000/a",
      },
    })
  command("back")
  // Nothing to go forward to.
  command("forward")
  assert.deepEqual(frame.calls, ["navigation.back"])
})
