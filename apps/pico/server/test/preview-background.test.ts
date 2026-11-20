import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"
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
const TAG = `<script data-pico-preview>${PREVIEW_BACKGROUND_SCRIPT}</script>`
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
    assert.match(await response.text(), /data-pico-preview/)
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
    assert.doesNotMatch(await fragment.text(), /data-pico-preview/)
    const frame = await fetch(`${origin}/plain`, {
      headers: { "sec-fetch-dest": "iframe" },
    })
    assert.match(await frame.text(), /data-pico-preview/)

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
  assert.doesNotThrow(() => new Function(PREVIEW_BACKGROUND_SCRIPT))
})
