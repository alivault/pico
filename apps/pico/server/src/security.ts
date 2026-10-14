import type { IncomingMessage } from "node:http"

import { ApiError } from "./http.ts"

export function isLoopback(host: string) {
  return ["127.0.0.1", "::1", "localhost"].includes(host)
}

/** Tailscale Serve keeps the MagicDNS host when it proxies to loopback. */
function isTailscaleHost(host: string) {
  return host.toLowerCase().endsWith(".ts.net")
}

/** Network access is controlled by Tailscale/firewall rules, not an app token. */
export class Security {
  readonly host: string

  constructor(host: string) {
    this.host = host
  }

  /** Apply the same browser request checks to HTTP, SSE, and terminal sockets. */
  check(request: IncomingMessage) {
    const authority = request.headers.host
    if (!authority) throw new ApiError(400, "Host is required")
    const url = new URL(`http://${authority}`)
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    if (
      isLoopback(this.host) &&
      !isLoopback(hostname) &&
      !isTailscaleHost(hostname)
    ) {
      throw new ApiError(403, "Host is not allowed")
    }
    const origin = request.headers.origin
    if (origin && new URL(origin).host !== authority)
      throw new ApiError(403, "Cross-origin requests are not allowed")
  }
}
