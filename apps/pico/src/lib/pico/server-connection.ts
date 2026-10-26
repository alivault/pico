/**
 * Whether the page can reach its Pico server (the hub). When the server is
 * down, every request fails. The page then shows one "server unreachable"
 * view (`ServerUnreachableOverlay`) instead of one error toast for each
 * failed request, and it checks the server again until it answers.
 */
import * as React from "react"

import { LOCAL_MACHINE_ID, machineApiUrl } from "@/lib/pico/machine"

export type ServerConnectionState = "unknown" | "online" | "unreachable"

export const SERVER_UNREACHABLE_MESSAGE = "Pico cannot reach its server."

/** A request that failed because the Pico server did not answer. */
export class ServerUnreachableError extends Error {
  constructor() {
    super(SERVER_UNREACHABLE_MESSAGE)
    this.name = "ServerUnreachableError"
  }
}

/**
 * Whether a failed response comes from a gateway in front of a stopped
 * server, such as the Vite proxy or a reverse proxy. The Pico server sends
 * JSON with its errors, so a 502, 503, or 504 without JSON is not from it.
 */
export function isGatewayFailure(status: number, body: string) {
  if (![502, 503, 504].includes(status)) return false
  try {
    JSON.parse(body)
    return false
  } catch {
    return true
  }
}

const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000]

let state: ServerConnectionState = "unknown"
const listeners = new Set<() => void>()
const reconnectListeners = new Set<() => void>()
let checking = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryCount = 0

function setState(next: ServerConnectionState) {
  if (state === next) return
  const reconnected = state === "unreachable" && next === "online"
  state = next
  for (const listener of listeners) listener()
  if (reconnected) for (const listener of reconnectListeners) listener()
}

/** Something from the server came in: it is reachable. */
export function markServerOnline() {
  if (retryTimer !== undefined) clearTimeout(retryTimer)
  retryTimer = undefined
  retryCount = 0
  setState("online")
}

/**
 * A request or stream failed in a way that can mean that the server is down.
 * Ask the server for its health. When it does not answer, the page is
 * unreachable until a later check gets an answer.
 */
export function checkServerConnection() {
  if (checking || retryTimer !== undefined) return
  checking = true
  void fetch(machineApiUrl(LOCAL_MACHINE_ID, "/api/system/health"), {
    cache: "no-store",
  })
    .then((response) => response.ok)
    .catch(() => false)
    .then((ok) => {
      checking = false
      if (ok) {
        markServerOnline()
        return
      }
      setState("unreachable")
      const delay =
        RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)]
      retryCount += 1
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        checkServerConnection()
      }, delay)
    })
}

export function serverConnectionState() {
  return state
}

/** Call `listener` each time the server answers again after a failure. */
export function onServerReconnect(listener: () => void) {
  reconnectListeners.add(listener)
  return () => {
    reconnectListeners.delete(listener)
  }
}

/** Call `listener` each time the connection state changes. */
export function onServerConnectionChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useServerConnection() {
  return React.useSyncExternalStore(
    onServerConnectionChange,
    serverConnectionState,
    serverConnectionState
  )
}
