/**
 * Lines that the file viewer must show: a link in the conversation or the
 * `open_file` tool asks for them, and the viewer of the file scrolls to them
 * and highlights them. A request waits here until the file's editor shows
 * it, as when the file must load first, and the editor then takes it.
 */
import * as React from "react"

export type FileReveal = {
  line: number
  endLine?: number
  /** A new number for each request, so the same lines can show again. */
  nonce: number
}

const reveals = new Map<string, FileReveal>()
const listeners = new Set<() => void>()
let nextNonce = 1

function revealKey(machineId: string, cwd: string, path: string) {
  return `${machineId}\u0000${cwd}\u0000${path}`
}

function notify() {
  for (const listener of listeners) listener()
}

/** Ask the viewer of a file to show lines. */
export function requestFileReveal(
  machineId: string,
  cwd: string,
  path: string,
  lines: { line: number; endLine?: number }
) {
  reveals.set(revealKey(machineId, cwd, path), {
    line: lines.line,
    ...(lines.endLine && lines.endLine > lines.line
      ? { endLine: lines.endLine }
      : {}),
    nonce: nextNonce++,
  })
  notify()
}

/** The editor showed the lines: forget the request. */
export function takeFileReveal(
  machineId: string,
  cwd: string,
  path: string,
  nonce: number
) {
  const key = revealKey(machineId, cwd, path)
  if (reveals.get(key)?.nonce !== nonce) return
  reveals.delete(key)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The lines that the viewer of a file must show, if any. */
export function useFileReveal(machineId: string, cwd: string, path: string) {
  const key = revealKey(machineId, cwd, path)
  return React.useSyncExternalStore(
    subscribe,
    () => reveals.get(key),
    () => undefined
  )
}
