/**
 * Files that the user attaches to a prompt and that the model cannot read
 * inline (all files that are not PNG, JPEG, GIF, or WebP images). The server
 * keeps each file in `<dataDir>/uploads/<id>/<name>` and the client puts the
 * path in the prompt, so the agent reads the file with its tools.
 */
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import type { IncomingMessage } from "node:http"
import { basename, join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { ApiError, badRequest } from "../http.ts"

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** A file name that is safe in a path and easy to read in a prompt. */
export function safeUploadName(name: string) {
  const clean = basename(name.replace(/\\/g, "/"))
    .replace(/[^\w.+-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120)
  return clean || "file"
}

/** Removes uploads that are older than 30 days. Errors do not matter. */
async function pruneUploads(root: string, now = Date.now()) {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry)
      try {
        const info = await stat(path)
        if (now - info.mtimeMs > KEEP_MS)
          await rm(path, { recursive: true, force: true })
      } catch {
        // Another request removed it.
      }
    })
  )
}

/** Writes the request body to a new upload and returns its absolute path. */
export async function saveUpload(
  dataDir: string,
  name: string,
  body: IncomingMessage
) {
  const declared = Number(body.headers["content-length"])
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES)
    throw new ApiError(413, "The file is larger than 1 GB")
  const root = join(dataDir, "uploads")
  void pruneUploads(root)
  const dir = join(root, randomUUID())
  await mkdir(dir, { recursive: true })
  const path = join(dir, safeUploadName(name))
  let size = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > MAX_UPLOAD_BYTES)
        callback(new ApiError(413, "The file is larger than 1 GB"))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(body, limit, createWriteStream(path, { flags: "wx" }))
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    if (error instanceof ApiError) throw error
    throw badRequest(
      `Could not save the file: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return path
}
