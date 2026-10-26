/**
 * The `scratchpad` extension: large tool output kept out of the model's
 * context.
 *
 * When the `scratchSpillKb` setting is above 0, an `afterTool` hook saves
 * tool output larger than that to a file and gives the model the head of it
 * and the file path. The model reads the rest with `read` or `bash`.
 *
 * Entries are files in `<data>/scratch/<conversation>/`, each with a small
 * JSON file of metadata. Files, not a document, because a tool hook can read
 * documents but not commit them. The web client lists them.
 */
import { randomBytes } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  defineExtension,
  hook,
  ToolTask,
  type ConversationId,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"

import type { HostBridge } from "./host.ts"
import { registerState } from "./util.ts"

export type ScratchEntry = {
  id: string
  name: string
  bytes: number
  lines: number
  createdAt: number
  /** The tool whose output was spilled here, if any. */
  source?: string
}

const ID = /^x[a-z0-9]{6,12}$/
const SPILL_HEAD_CHARS = 2000
/** Tools that read a spill file, or that spill on their own. */
const NEVER_SPILL = new Set(["read", "codemode"])

export class Scratchpad {
  readonly #root: string

  constructor(dataDir: string) {
    this.#root = join(dataDir, "scratch")
  }

  #dir(conversationId: ConversationId | number) {
    return join(this.#root, String(conversationId))
  }

  static newId() {
    return `x${randomBytes(5).toString("hex").slice(0, 8)}`
  }

  async put(
    conversationId: ConversationId | number,
    content: string,
    options: { id?: string; name?: string; source?: string } = {}
  ): Promise<ScratchEntry> {
    const id = options.id ?? Scratchpad.newId()
    const dir = this.#dir(conversationId)
    await mkdir(dir, { recursive: true })
    const entry: ScratchEntry = {
      id,
      name: (options.name ?? options.source ?? "note").slice(0, 120),
      bytes: Buffer.byteLength(content),
      lines: content.split("\n").length,
      createdAt: Date.now(),
      ...(options.source ? { source: options.source } : {}),
    }
    await writeFile(join(dir, `${id}.txt`), content)
    await writeFile(join(dir, `${id}.json`), JSON.stringify(entry))
    return entry
  }

  /** The file of an entry of the conversation. */
  path(conversationId: ConversationId | number, id: string) {
    return join(this.#dir(conversationId), `${id}.txt`)
  }

  async list(conversationId: ConversationId | number) {
    const dir = this.#dir(conversationId)
    const names = await readdir(dir).catch(() => [] as string[])
    const entries: ScratchEntry[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      try {
        entries.push(
          JSON.parse(await readFile(join(dir, name), "utf8")) as ScratchEntry
        )
      } catch {
        // A partly written entry; skip it.
      }
    }
    return entries.sort((left, right) => left.createdAt - right.createdAt)
  }

  /** The directory of an entry: the conversation's own, or any other. */
  async #find(conversationId: ConversationId | number, id: string) {
    if (!ID.test(id)) return undefined
    const own = this.#dir(conversationId)
    const ownText = await readFile(join(own, `${id}.txt`), "utf8").catch(
      () => undefined
    )
    if (ownText !== undefined) return { dir: own, text: ownText }
    for (const name of await readdir(this.#root).catch(() => [] as string[])) {
      const dir = join(this.#root, name)
      const text = await readFile(join(dir, `${id}.txt`), "utf8").catch(
        () => undefined
      )
      if (text !== undefined) return { dir, text }
    }
    return undefined
  }

  async get(conversationId: ConversationId | number, id: string) {
    return (await this.#find(conversationId, id))?.text
  }

  async delete(conversationId: ConversationId | number, id: string) {
    if (!ID.test(id)) return false
    const dir = this.#dir(conversationId)
    const existed = await readFile(join(dir, `${id}.json`)).then(
      () => true,
      () => false
    )
    await rm(join(dir, `${id}.txt`), { force: true })
    await rm(join(dir, `${id}.json`), { force: true })
    return existed
  }
}

function resultText(result: ToolExecutionResult) {
  if (!result.output) return undefined
  if (result.output.some((part) => part.type !== "text")) return undefined
  return result.output
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

export function createScratchpadExtension(host: HostBridge, dataDir: string) {
  const scratch = new Scratchpad(dataDir)

  registerState({
    key: "scratch",
    kinds: [],
    async read(_reader, conversationId) {
      const entries = await scratch.list(conversationId)
      return entries.length > 0 ? entries : undefined
    },
  })

  const spill = hook(ToolTask, {
    afterTool: async (call, result, api) => {
      const limitKb = host.current?.settings().scratchSpillKb ?? 0
      if (limitKb <= 0 || call.parent || NEVER_SPILL.has(call.name))
        return undefined
      const text = resultText(result)
      if (text === undefined || Buffer.byteLength(text) <= limitKb * 1024)
        return undefined
      const entry = await scratch.put(api.conversationId, text, {
        source: call.name,
        name: `${call.name} output`,
      })
      return {
        ...result,
        output: [
          {
            type: "text",
            text: `${text.slice(0, SPILL_HEAD_CHARS)}\n…\n[The full output (${entry.lines} lines, ${entry.bytes} bytes) is in the file ${scratch.path(api.conversationId, entry.id)}. Read more of it with read (offset, limit) or with rg in bash.]`,
          },
        ],
      }
    },
  })

  return {
    scratch,
    extension: defineExtension({
      name: "scratchpad",
      hooks: [spill],
    }),
  }
}
