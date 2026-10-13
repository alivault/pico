import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import { ApiError } from "./http.ts"

export function isLoopback(host: string) {
  return ["127.0.0.1", "::1", "localhost"].includes(host)
}

function equal(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Protect HTTP, SSE, and terminal sockets with the same policy. */
export class Security {
  readonly host: string
  readonly token: string | undefined
  constructor(host: string, token = process.env.PICO_TOKEN) {
    this.host = host
    this.token = token
    if (!isLoopback(host) && (!token || token.length < 24)) {
      throw new Error(
        "Remote binding requires PICO_TOKEN with at least 24 characters"
      )
    }
  }

  check(request: IncomingMessage) {
    const authority = request.headers.host
    if (!authority) throw new ApiError(400, "Host is required")
    const url = new URL(`http://${authority}`)
    if (
      isLoopback(this.host) &&
      !isLoopback(url.hostname.replace(/^\[|\]$/g, ""))
    ) {
      throw new ApiError(403, "Host is not allowed")
    }
    const origin = request.headers.origin
    if (origin && new URL(origin).host !== authority)
      throw new ApiError(403, "Cross-origin requests are not allowed")
    if (!this.token) return
    const bearer = request.headers.authorization?.replace(/^Bearer /, "")
    const cookie = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("pico_token="))
      ?.slice(11)
    if (
      !equal(bearer ?? (cookie ? decodeURIComponent(cookie) : ""), this.token)
    )
      throw new ApiError(401, "Pico token is required")
  }

  /** A same-origin login form sets a cookie so EventSource and WebSocket work. */
  async login(request: IncomingMessage, response: ServerResponse) {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/login")
      return false
    if (request.method === "POST") {
      const origin = request.headers.origin
      if (origin && new URL(origin).host !== request.headers.host)
        throw new ApiError(403, "Cross-origin login is not allowed")
      let body = ""
      for await (const chunk of request) {
        body += String(chunk)
        if (body.length > 4096)
          throw new ApiError(413, "Login body is too large")
      }
      const token = new URLSearchParams(body).get("token") ?? ""
      if (!this.token || !equal(token, this.token))
        throw new ApiError(401, "Invalid token")
      response.writeHead(303, {
        location: "/",
        "set-cookie": `pico_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
        "cache-control": "no-store",
      })
      response.end()
      return true
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    })
    response.end(
      '<!doctype html><title>Pico login</title><h1>Pico</h1><form method="post"><label>Access token <input name="token" type="password" required autofocus></label><button>Connect</button></form>'
    )
    return true
  }
}
