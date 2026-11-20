/**
 * The background and the location of a previewed page. The Preview iframe
 * shows its own background color in the overscroll gap (rubberband scroll on
 * macOS), so the preview listener puts a small script into each HTML page.
 * The script tells the parent (Smith) the page's background color and color
 * scheme, and Smith gives the iframe that color. It also tells the page's
 * address when it changes, so Smith can show it and keep a history for the
 * Back and Forward buttons, and it goes back or forward when Smith asks.
 *
 * The script goes in as the page streams: the proxy keeps the first bytes
 * until it finds `<head>`, puts the script after it, and sends the rest as
 * it comes. A compressed page is decompressed and sent without compression.
 * When the page has a Content-Security-Policy for scripts, the proxy adds
 * the sha256 hash of the script to it, so the script can run.
 */
import { createHash } from "node:crypto"
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http"
import { Transform, type TransformCallback } from "node:stream"
import * as zlib from "node:zlib"

/** The message type that the script posts to the parent window. */
export const PREVIEW_BACKGROUND_MESSAGE = "smith-preview-background"

/** The message type of a new address of the page. */
export const PREVIEW_LOCATION_MESSAGE = "smith-preview-location"

/** The message type of a command from the parent window. */
export const PREVIEW_COMMAND_MESSAGE = "smith-preview-command"

/**
 * Posts `{ type, color, colorScheme }` to the parent window. `color` is the
 * computed background color of `html`, else of `body`, else "transparent".
 * `colorScheme` is the used color scheme: "light" or "dark". It sends when
 * the value changes: on DOMContentLoaded, load, attribute changes of html
 * and body, new styles, and a change of the system color scheme.
 *
 * Posts `{ type: "smith-preview-location", href, kind }` when the address
 * changes: at the start, after `history.pushState` and `replaceState`, and
 * on popstate, hashchange and pageshow. `kind` is "load", "push",
 * "replace" or "pop".
 *
 * Takes `{ type: "smith-preview-command", action: "back" | "forward",
 * href }` from the parent window only. `href` is the address that Smith
 * expects. With the Navigation API, it goes back or forward: that moves
 * only in this frame's own history. Without it, it loads `href` in place
 * with `location.replace` when `href` is on the page's origin. It never
 * calls `history.back()` or `forward()`: they move in the history that the
 * frame shares with Smith's page, so they can undo a route change of Smith.
 */
export const PREVIEW_BACKGROUND_SCRIPT = `(function(){try{
if(window.parent===window)return;
var d=document,r=d.documentElement,last="",queued=false;
var mq=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;
function clear(c){return !c||c==="transparent"||/^rgba\\(.*,\\s*0\\)$/.test(c)||/\\/\\s*0\\)$/.test(c)}
function scheme(){var v=getComputedStyle(r).colorScheme||"";
if(!v||v==="normal"){var m=d.querySelector('meta[name="color-scheme"]');v=m&&m.content||""}
return /dark/.test(v)&&(!/light/.test(v)||!!(mq&&mq.matches))?"dark":"light"}
function send(){try{
var c=getComputedStyle(r).backgroundColor;
if(clear(c)&&d.body)c=getComputedStyle(d.body).backgroundColor;
if(clear(c))c="transparent";
var s=scheme(),key=c+"|"+s;if(key===last)return;last=key;
window.parent.postMessage({type:"${PREVIEW_BACKGROUND_MESSAGE}",color:c,colorScheme:s},"*")
}catch(e){}}
function later(){if(queued)return;queued=true;
(window.requestAnimationFrame||setTimeout)(function(){queued=false;send()})}
var mo=new MutationObserver(later);
function watch(){mo.observe(r,{attributes:true,childList:true});
if(d.head)mo.observe(d.head,{childList:true});
if(d.body)mo.observe(d.body,{attributes:true})}
watch();
d.addEventListener("DOMContentLoaded",function(){watch();send()});
window.addEventListener("load",send);
window.addEventListener("pageshow",send);
d.addEventListener("load",later,true);
d.addEventListener("transitionend",later,true);
if(mq){if(mq.addEventListener)mq.addEventListener("change",later);else if(mq.addListener)mq.addListener(later)}
var H=history,N=window.navigation,href="";
function loc(kind){try{var h=location.href;if(h===href)return;href=h;
window.parent.postMessage({type:"${PREVIEW_LOCATION_MESSAGE}",href:h,kind:kind},"*")}catch(e){}}
function wrap(name,kind){var f=H[name];if(typeof f!=="function")return;
H[name]=function(){var v=f.apply(this,arguments);loc(kind);return v}}
wrap("pushState","push");wrap("replaceState","replace");
function pop(){loc("pop")}
window.addEventListener("popstate",pop);
window.addEventListener("hashchange",pop);
window.addEventListener("pageshow",pop);
function none(){}
function go(back,to){if(N&&N.back){if(back?!N.canGoBack:!N.canGoForward)return;
var r=back?N.back():N.forward();if(r){if(r.committed)r.committed.catch(none);if(r.finished)r.finished.catch(none)}return}
if(typeof to!=="string")return;var u=new URL(to,location.href);
if(u.origin===location.origin&&u.href!==location.href)location.replace(u.href)}
window.addEventListener("message",function(e){try{
if(e.source!==window.parent)return;var m=e.data;
if(!m||m.type!=="${PREVIEW_COMMAND_MESSAGE}")return;
if(m.action==="back")go(true,m.href);else if(m.action==="forward")go(false,m.href)
}catch(x){}});
loc("load")
}catch(e){}})();`

const SCRIPT_HASH = `'sha256-${createHash("sha256")
  .update(PREVIEW_BACKGROUND_SCRIPT, "utf8")
  .digest("base64")}'`

const SCRIPT_TAG = Buffer.from(
  `<script data-smith-preview>${PREVIEW_BACKGROUND_SCRIPT}</script>`,
  "utf8"
)

/** How much of the page start the proxy keeps to find `<head>`. */
const SEARCH_LIMIT = 64 * 1024

/**
 * Add the script hash to a Content-Security-Policy header, so the inline
 * script can run. In each policy, it changes script-src-elem and
 * script-src, or default-src when neither is there. A directive that
 * allows all inline scripts ('unsafe-inline' with no nonce or hash) stays
 * as it is: a hash would turn 'unsafe-inline' off.
 */
export function allowPreviewScript(policy: string) {
  return policy
    .split(",")
    .map((single) => {
      const directives = single.split(";")
      const names = directives.map(
        (part) => /^\s*([a-z-]+)/i.exec(part)?.[1]?.toLowerCase() ?? ""
      )
      const targets = names.some(
        (name) => name === "script-src" || name === "script-src-elem"
      )
        ? ["script-src", "script-src-elem"]
        : ["default-src"]
      return directives
        .map((part, index) => {
          if (!targets.includes(names[index]!)) return part
          const sources = part.trim().split(/\s+/).slice(1)
          const lower = sources.map((source) => source.toLowerCase())
          const inline = lower.includes("'unsafe-inline'")
          const keyed = lower.some((source) =>
            /^'(?:nonce|sha256|sha384|sha512)-/.test(source)
          )
          if (inline && !keyed) return part
          const kept = sources.filter(
            (_, at) => lower[at] !== "'none'" && sources[at] !== SCRIPT_HASH
          )
          const leading = /^\s*/.exec(part)?.[0] ?? ""
          return `${leading}${[names[index], ...kept, SCRIPT_HASH].join(" ")}`
        })
        .join(";")
    })
    .join(",")
}

/**
 * Where the script goes, as a byte offset: after `<head>`, else after
 * `<html>`, else after the doctype, else at the start (after a byte order
 * mark). Undefined while a later chunk can still bring `<head>`.
 */
export function injectionOffset(start: Buffer, complete: boolean) {
  // latin1 keeps one character for each byte, so the offsets are bytes.
  const text = start.toString("latin1")
  const head = /<head(?:\s[^>]*)?>/i.exec(text)
  if (head) return head.index + head[0].length
  if (!complete && !/<body[\s>]/i.test(text) && start.length < SEARCH_LIMIT)
    return undefined
  const html = /<html(?:\s[^>]*)?>/i.exec(text)
  if (html) return html.index + html[0].length
  const doctype = /^(?:\uFEFF|\u00EF\u00BB\u00BF)?\s*<!doctype[^>]*>/i.exec(
    text
  )
  if (doctype) return doctype[0].length
  return text.startsWith("\u00EF\u00BB\u00BF") ? 3 : 0
}

/** Put the script in a complete HTML document. */
export function injectPreviewScript(html: Buffer) {
  const offset = injectionOffset(html, true)!
  return Buffer.concat([
    html.subarray(0, offset),
    SCRIPT_TAG,
    html.subarray(offset),
  ])
}

/** A stream that puts the script into the HTML that goes through it. */
class InjectScript extends Transform {
  #start: Buffer[] = []
  #length = 0
  #done = false

  override _transform(
    chunk: Buffer,
    _: BufferEncoding,
    next: TransformCallback
  ) {
    if (this.#done) {
      next(null, chunk)
      return
    }
    this.#start.push(chunk)
    this.#length += chunk.length
    this.#flush(false)
    next()
  }

  override _flush(next: TransformCallback) {
    if (!this.#done) this.#flush(true)
    next()
  }

  #flush(complete: boolean) {
    const start = Buffer.concat(this.#start, this.#length)
    const offset = injectionOffset(start, complete)
    if (offset === undefined) {
      this.#start = [start]
      return
    }
    this.#done = true
    this.#start = []
    this.push(
      Buffer.concat([
        start.subarray(0, offset),
        SCRIPT_TAG,
        start.subarray(offset),
      ])
    )
  }
}

/** Raw or zlib-wrapped deflate: servers send both as "deflate". */
class Inflate extends Transform {
  #inner: zlib.Inflate | zlib.InflateRaw | undefined

  override _transform(
    chunk: Buffer,
    _: BufferEncoding,
    next: TransformCallback
  ) {
    if (!this.#inner) {
      // A zlib header: compression method 8, and a check value.
      const wrapped =
        chunk.length >= 2 &&
        (chunk[0]! & 0x0f) === 8 &&
        (chunk[0]! * 256 + chunk[1]!) % 31 === 0
      const inner = wrapped ? zlib.createInflate() : zlib.createInflateRaw()
      inner.on("data", (data: Buffer) => this.push(data))
      inner.on("error", (error) => this.destroy(error))
      this.#inner = inner
    }
    this.#inner.write(chunk, () => next())
  }

  override _flush(next: TransformCallback) {
    if (!this.#inner) {
      next()
      return
    }
    this.#inner.once("end", () => next())
    this.#inner.end()
  }
}

function decoder(encoding: string): Transform | undefined | false {
  switch (encoding) {
    case "":
    case "identity":
      return undefined
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip()
    case "br":
      return zlib.createBrotliDecompress()
    case "deflate":
      return new Inflate()
    case "zstd": {
      // Node 22.15 and later.
      const create = (zlib as { createZstdDecompress?: () => Transform })
        .createZstdDecompress
      return create ? create() : false
    }
    default:
      return false
  }
}

/** Fetch destinations of a page in a frame or a tab. */
const DOCUMENT_DESTINATIONS = new Set(["document", "iframe", "frame"])

/**
 * The page to send with the script, or undefined to send the reply as it
 * is: only HTML documents (GET, status 200) in a known encoding.
 */
export function previewPage(
  request: { method?: string; headers: IncomingHttpHeaders },
  reply: IncomingMessage,
  headers: OutgoingHttpHeaders
): { headers: OutgoingHttpHeaders; body: Transform } | undefined {
  if (request.method !== "GET" || reply.statusCode !== 200) return undefined
  const destination = request.headers["sec-fetch-dest"]
  if (
    typeof destination === "string" &&
    !DOCUMENT_DESTINATIONS.has(destination.toLowerCase())
  )
    return undefined
  const type = reply.headers["content-type"]
  if (typeof type !== "string" || !/^\s*text\/html\b/i.test(type))
    return undefined
  const encoding = (reply.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase()
  const decode = decoder(encoding)
  if (decode === false) return undefined
  const result: OutgoingHttpHeaders = { ...headers }
  delete result["content-length"]
  delete result["content-encoding"]
  if (encoding) {
    // The bytes change, so a strong validator is not true any more.
    const tag = result.etag
    if (typeof tag === "string" && !tag.startsWith("W/"))
      result.etag = `W/${tag}`
  }
  for (const name of [
    "content-security-policy",
    "content-security-policy-report-only",
  ]) {
    const policy = result[name]
    if (typeof policy === "string") result[name] = allowPreviewScript(policy)
    else if (Array.isArray(policy))
      result[name] = policy.map((item) => allowPreviewScript(item))
  }
  const inject = new InjectScript()
  if (decode) {
    reply.pipe(decode).pipe(inject)
    decode.on("error", (error) => inject.destroy(error))
  } else reply.pipe(inject)
  return { headers: result, body: inject }
}
