import { homedir } from "node:os"
import { join, resolve } from "node:path"

declare const PICO_VERSION: string

/** The server version, injected at build time. */
export const VERSION: string =
  typeof PICO_VERSION === "string" ? PICO_VERSION : "0.0.0-dev"

/** Version of the HTTP/SSE contract with the web client. */
export const API_CONTRACT_VERSION = 1

/** Version of the server itself; v3 is the durable rewrite. */
export const SERVER_PROTOCOL_VERSION = 3

export const DEFAULT_PORT = 3141

export type ServerPaths = {
  /** Pico's own data: the durable database, settings, and server state. */
  dataDir: string
  database: string
  settingsFile: string
  viewersFile: string
  stateFile: string
  lockFile: string
  /** Built web client, served as a single-page app. */
  webDir: string | undefined
}

export function defaultDataDir() {
  const fromEnv = process.env.PICO_HOME?.trim()
  return fromEnv ? resolve(fromEnv) : join(homedir(), ".pico")
}

export function serverPaths(dataDir: string, webDir?: string): ServerPaths {
  return {
    dataDir,
    database: join(dataDir, "pico.sqlite"),
    settingsFile: join(dataDir, "settings.json"),
    viewersFile: join(dataDir, "viewers.json"),
    stateFile: join(dataDir, "server.json"),
    lockFile: join(dataDir, "server.lock"),
    webDir,
  }
}
