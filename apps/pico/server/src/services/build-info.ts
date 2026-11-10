/**
 * What the server runs, and whether a newer build is on disk: a `pnpm build`
 * or a package upgrade replaces the files, and a restart loads them. The web
 * client is a separate build; a page reload loads it.
 */
import { readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { VERSION } from "../config.ts"

export type ServerUpdate = {
  /** A restart runs newer server code. */
  available: boolean
  /** The version on disk, when it is not the running version. */
  version?: string
}

function mtime(path: string) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * The bundle of this program (`server/dist/pico-server.mjs`) and the package
 * root above it: `apps/pico` in the repository, the package in an install.
 */
const script = fileURLToPath(import.meta.url)
const packageFile = resolve(dirname(script), "..", "..", "package.json")
const startedWith = mtime(script)

function diskVersion() {
  try {
    const { version } = JSON.parse(readFileSync(packageFile, "utf8")) as {
      version?: unknown
    }
    return typeof version === "string" ? version : undefined
  } catch {
    return undefined
  }
}

export function serverUpdate(): ServerUpdate {
  const version = diskVersion()
  const now = mtime(script)
  const rebuilt =
    startedWith !== undefined && now !== undefined && now !== startedWith
  const newVersion = version !== undefined && version !== VERSION
  return {
    available: rebuilt || newVersion,
    ...(newVersion ? { version } : {}),
  }
}

/** A value that changes with each build of the web client. */
export function webBuildId(webDir: string | undefined) {
  if (!webDir) return undefined
  const time = mtime(join(webDir, "index.html"))
  return time === undefined ? undefined : String(Math.round(time))
}
