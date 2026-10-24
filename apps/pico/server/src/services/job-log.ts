/**
 * The log files of background jobs.
 *
 * A job writes its raw terminal output to `<data>/jobs/<id>.log`. When that
 * file gets to `LOG_PART_BYTES`, it becomes `<id>.1.log` (the earlier part is
 * deleted) and a new `<id>.log` starts. So a log keeps the most recent output,
 * and it never uses more than two parts on disk.
 *
 * Reads do not load a whole log: the tail is read from the end, and line
 * scans stream the parts.
 */
import {
  closeSync,
  createReadStream,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"

export const LOG_PART_BYTES = 10 * 1024 * 1024

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(
  [
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}[@-Z\\\\-_]`,
  ].join("|"),
  "g"
)

/** One line of terminal output as plain text: no escape codes, carriage returns applied. */
export function plainLine(line: string) {
  const parts = line.replace(ANSI, "").replace(/\r$/, "").split("\r")
  return (parts[parts.length - 1] ?? "").trimEnd()
}

/**
 * Terminal output as plain text: no escape codes, carriage returns applied,
 * and runs of blank lines (from screen clears) cut to one.
 */
export function plainText(output: string) {
  return output
    .replace(ANSI, "")
    .split("\n")
    .map((line) => plainLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

function checkId(jobId: string) {
  if (!/^[a-z0-9]+$/i.test(jobId)) throw new Error("Invalid job id")
}

export function jobLogPath(dataDir: string, jobId: string) {
  checkId(jobId)
  return join(dataDir, "jobs", `${jobId}.log`)
}

/** The parts of a job log that exist, the oldest first. */
export function jobLogParts(dataDir: string, jobId: string) {
  checkId(jobId)
  const dir = join(dataDir, "jobs")
  return [join(dir, `${jobId}.1.log`), join(dir, `${jobId}.log`)].filter(
    (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    }
  )
}

/** Delete all parts of a job log. */
export function deleteJobLog(dataDir: string, jobId: string) {
  for (const path of jobLogParts(dataDir, jobId)) {
    try {
      unlinkSync(path)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Appends output to a job log, and starts a new part when a part is full.
 * Writes are synchronous, so a rotation never races an open or a write.
 */
export class JobLogWriter {
  readonly #path: string
  readonly #older: string
  readonly #partBytes: number
  #fd: number | undefined
  #bytes: number

  constructor(dataDir: string, jobId: string, partBytes = LOG_PART_BYTES) {
    this.#path = jobLogPath(dataDir, jobId)
    this.#older = join(dataDir, "jobs", `${jobId}.1.log`)
    this.#partBytes = partBytes
    mkdirSync(join(dataDir, "jobs"), { recursive: true })
    this.#fd = openSync(this.#path, "a")
    this.#bytes = fstatSync(this.#fd).size
  }

  write(data: string) {
    if (this.#fd === undefined) return
    const buffer = Buffer.from(data)
    if (this.#bytes > 0 && this.#bytes + buffer.length > this.#partBytes)
      this.#rotate()
    try {
      writeSync(this.#fd, buffer)
      this.#bytes += buffer.length
    } catch (error) {
      console.warn("[pico] could not write a job log:", error)
    }
  }

  #rotate() {
    try {
      closeSync(this.#fd!)
      renameSync(this.#path, this.#older)
    } catch (error) {
      console.warn("[pico] could not rotate a job log:", error)
    }
    this.#bytes = 0
    try {
      this.#fd = openSync(this.#path, "a")
    } catch (error) {
      // No log from here on; the job goes on.
      this.#fd = undefined
      console.warn("[pico] could not open a job log:", error)
    }
  }

  /** Close the log. */
  end() {
    if (this.#fd === undefined) return
    try {
      closeSync(this.#fd)
    } catch {
      // Already closed.
    }
    this.#fd = undefined
  }
}

/**
 * The last `maxBytes` of a log as raw output. When the read does not start
 * at the start of the log, it starts after the first line break, so it does
 * not begin in the middle of a line or an escape sequence.
 */
export function readLogTailRaw(parts: string[], maxBytes: number) {
  const chunks: Buffer[] = []
  let remaining = maxBytes
  let cut = false
  for (let index = parts.length - 1; index >= 0 && remaining > 0; index -= 1) {
    let fd: number | undefined
    try {
      fd = openSync(parts[index]!, "r")
      const size = statSync(parts[index]!).size
      const length = Math.min(size, remaining)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      chunks.unshift(buffer)
      remaining -= length
      if (length < size || (remaining <= 0 && index > 0)) cut = true
    } catch {
      // A part that is gone reads as empty.
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  let text = Buffer.concat(chunks).toString("utf8")
  if (cut) {
    const newline = text.indexOf("\n")
    text = newline >= 0 ? text.slice(newline + 1) : ""
  }
  return text
}

/**
 * The last `count` plain-text lines of a log. It reads from the end in
 * growing steps, and stops at `maxBytes`.
 */
export function readLogTailLines(
  parts: string[],
  count: number,
  maxBytes = 8 * 1024 * 1024
) {
  let total = 0
  for (const path of parts) {
    try {
      total += statSync(path).size
    } catch {
      // Gone.
    }
  }
  let bytes = 64 * 1024
  for (;;) {
    const lines = plainText(readLogTailRaw(parts, bytes)).trimEnd().split("\n")
    if (lines.length > count || bytes >= total || bytes >= maxBytes) {
      const selected = lines.slice(-count)
      return selected.length === 1 && selected[0] === "" ? [] : selected
    }
    bytes *= 4
  }
}

/**
 * Stream the plain-text lines of a log, with their numbers (from 1). Runs of
 * blank lines count as one blank line, as in `plainText`. Return false from
 * `visit` to stop.
 */
export async function scanLogLines(
  parts: string[],
  visit: (line: string, number: number) => boolean | void
) {
  let number = 0
  let blanks = 0
  for (const path of parts) {
    const stream = createReadStream(path, { encoding: "utf8" })
    const reader = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const raw of reader) {
        const line = plainLine(raw)
        if (line === "") {
          blanks += 1
          if (blanks > 1) continue
        } else blanks = 0
        number += 1
        if (visit(line, number) === false) return number
      }
    } catch {
      // A part that is gone reads as empty.
    } finally {
      reader.close()
      stream.destroy()
    }
  }
  return number
}
