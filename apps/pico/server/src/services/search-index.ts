/**
 * A full-text index of all conversations, for the search across agents.
 *
 * The index is its own SQLite file, `<data>/search.sqlite`, so it never
 * changes the schema of the durable database, and it can be deleted at any
 * time: it builds again. It holds one row for each entry with text: user
 * messages, assistant text with the tool calls in short, compaction
 * summaries, and the start of each tool result. It does not hold thinking,
 * images, or the rest of long tool results.
 *
 * Entry IDs only grow, so the index reads the durable database from the
 * last entry that it has, in small batches between other work. It reads
 * through its own read-only connection; SQLite's WAL lets it read while the
 * server writes.
 *
 * The index knows conversations, not agents: `core/agent-search.ts` maps
 * hits to agents, and drops conversations that are not agents.
 */
import { mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync, type StatementSync } from "node:sqlite"

/** Change it when the rows change: a new version builds the index again. */
const INDEX_VERSION = 1

/** How much of a tool result the index keeps. */
const TOOL_RESULT_CHARS = 1000
/** How much of the arguments of a tool call the index keeps. */
const TOOL_ARGS_CHARS = 300
/** Rows read in one batch. A batch takes a few ms. */
const BATCH_ROWS = 100
/** The longest time of one indexing step, before it lets other work run. */
const STEP_MS = 25

export type IndexedKind = "user" | "assistant" | "tool" | "summary"

export type SearchHit = {
  entryId: number
  conversation: number
  kind: IndexedKind
  ts: number | undefined
  /** The text around the match; the match is between `\uE000` and `\uE001`. */
  snippet: string
  rank: number
}

export type IndexedEntry = {
  entryId: number
  conversation: number
  kind: IndexedKind
  ts: number | undefined
  text: string
}

/** The start and end markers of a match in a snippet. */
export const MATCH_START = "\uE000"
export const MATCH_END = "\uE001"

type ContentPart = {
  type?: string
  text?: string
  name?: string
  arguments?: unknown
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function textOf(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return (content as ContentPart[])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
}

/** A tool call in short: its name and the main argument. */
function toolCallText(part: ContentPart) {
  const args =
    part.arguments && typeof part.arguments === "object"
      ? (part.arguments as Record<string, unknown>)
      : {}
  const main =
    typeof args.command === "string"
      ? args.command
      : typeof args.code === "string"
        ? args.code
        : JSON.stringify(args)
  return `[${part.name ?? "tool"}] ${clip(main ?? "", TOOL_ARGS_CHARS)}`
}

/**
 * The row of an entry, or undefined for an entry without text to search.
 * `data` is the entry record, or for a tool result the short object that
 * the batch query makes (see `readBatch`).
 */
export function entryRow(
  data: string
): Omit<IndexedEntry, "entryId" | "conversation"> | undefined {
  let record: {
    kind?: string
    tool?: string
    text?: string
    ts?: number
    model?: Array<{ role?: string; content?: unknown; timestamp?: number }>
  }
  try {
    record = JSON.parse(data) as typeof record
  } catch {
    return undefined
  }
  const message = record.model?.[0]
  const ts = message?.timestamp ?? record.ts
  const row = (kind: IndexedKind, text: string) => {
    const trimmed = text.trim()
    return trimmed ? { kind, ts, text: trimmed } : undefined
  }
  switch (record.kind) {
    case "pi.user":
      return row("user", textOf(message?.content))
    case "pi.compaction":
      return row("summary", textOf(message?.content))
    case "pi.assistant": {
      const parts = Array.isArray(message?.content)
        ? (message.content as ContentPart[])
        : []
      return row(
        "assistant",
        parts
          .map((part) =>
            part.type === "text"
              ? (part.text ?? "")
              : part.type === "toolCall"
                ? toolCallText(part)
                : ""
          )
          .filter(Boolean)
          .join("\n")
      )
    }
    case "pi.tool-result":
      return row(
        "tool",
        `[${record.tool ?? "tool"} result] ${record.text ?? ""}`
      )
    default:
      return undefined
  }
}

/**
 * An FTS5 query from what a person types: each word or "quoted phrase"
 * must match. With `prefix`, the last word may be the start of a word.
 * `any` makes one match enough. Undefined when there is nothing to search.
 */
export function matchQuery(
  input: string,
  options: { prefix?: boolean; any?: boolean } = {}
) {
  const terms = [...input.matchAll(/"([^"]*)"|(\S+)/g)]
    .map((match) => (match[1] ?? match[2] ?? "").replace(/"/g, " ").trim())
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
  if (terms.length === 0) return undefined
  return terms
    .map((term, index) => {
      const quoted = `"${term}"`
      const last = index === terms.length - 1
      return options.prefix && last && !/\s/.test(term) ? `${quoted}*` : quoted
    })
    .join(options.any ? " OR " : " ")
}

export class SearchIndex {
  readonly #file: string
  readonly #source: string
  #db: DatabaseSync | undefined
  #durable: DatabaseSync | undefined
  #readBatch: StatementSync | undefined
  #insertRow: StatementSync | undefined
  #insertText: StatementSync | undefined
  #lastEntry = 0
  #running: Promise<void> | undefined
  #timer: NodeJS.Timeout | undefined
  #closed = false
  #error: string | undefined
  /** The newest entry of the durable database when the index was last behind. */
  #target = 0

  /**
   * @param file the index file, for example `<data>/search.sqlite`
   * @param source the durable database
   */
  constructor(file: string, source: string) {
    this.#file = file
    this.#source = source
  }

  /** Open the index and start to fill it. It never throws. */
  start() {
    try {
      this.#open()
    } catch (error) {
      this.#error = `Search is not available: ${error instanceof Error ? error.message : String(error)}`
      console.warn(`[pico] ${this.#error}`)
      return
    }
    void this.catchUp()
    // New entries come all the time: index them a few seconds later.
    this.#timer = setInterval(() => void this.catchUp(), 5000)
    this.#timer.unref()
  }

  #open() {
    mkdirSync(dirname(this.#file), { recursive: true })
    let db = new DatabaseSync(this.#file)
    const version = (() => {
      try {
        return (
          db.prepare("SELECT value FROM state WHERE key = 'version'").get() as
            | { value: number }
            | undefined
        )?.value
      } catch {
        return undefined
      }
    })()
    if (version !== undefined && version !== INDEX_VERSION) {
      db.close()
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(this.#file + suffix, { force: true })
      db = new DatabaseSync(this.#file)
    }
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value ANY);
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY,
        conversation INTEGER NOT NULL,
        kind TEXT NOT NULL,
        ts INTEGER,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entries_by_conversation
        ON entries (conversation, id);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        text, content = 'entries', content_rowid = 'id',
        tokenize = 'porter unicode61'
      );
    `)
    db.prepare(
      "INSERT OR REPLACE INTO state (key, value) VALUES ('version', ?)"
    ).run(INDEX_VERSION)
    this.#lastEntry =
      (
        db.prepare("SELECT value FROM state WHERE key = 'last_entry'").get() as
          | { value: number }
          | undefined
      )?.value ?? 0
    this.#insertRow = db.prepare(
      "INSERT OR REPLACE INTO entries (id, conversation, kind, ts, text) VALUES (?, ?, ?, ?, ?)"
    )
    this.#insertText = db.prepare(
      "INSERT INTO entries_fts (rowid, text) VALUES (?, ?)"
    )
    this.#db = db
    this.#durable = new DatabaseSync(this.#source, { readOnly: true })
    // A tool result can be large: SQLite takes only its start, so the
    // server does not parse it.
    this.#readBatch = this.#durable.prepare(`
      SELECT id, conversation_id AS conversation,
        CASE WHEN json_extract(record, '$.kind') = 'pi.tool-result'
          THEN json_object(
            'kind', 'pi.tool-result',
            'tool', json_extract(record, '$.model[0].toolName'),
            'text', substr(json_extract(record, '$.model[0].content[0].text'), 1, ${TOOL_RESULT_CHARS}),
            'ts', json_extract(record, '$.model[0].timestamp'))
          ELSE record END AS data
      FROM entries WHERE id > ? ORDER BY id LIMIT ${BATCH_ROWS}
    `)
  }

  /** Why search does not work, when it does not. */
  get error() {
    return this.#error
  }

  /** How far the index is: indexed up to `lastEntry` of `newestEntry`. */
  status() {
    return {
      ready: !this.#error && this.#lastEntry >= this.#target,
      lastEntry: this.#lastEntry,
      newestEntry: this.#target,
      ...(this.#error ? { error: this.#error } : {}),
    }
  }

  /**
   * Index the new entries. Runs in steps of a few ms and lets other work run
   * between them. With `budgetMs`, it returns after that time even when
   * entries are left (a search uses it to be up to date, but not slow).
   */
  catchUp(budgetMs?: number): Promise<void> {
    if (!this.#db || this.#closed) return Promise.resolve()
    const running = (this.#running ??= this.#run().finally(() => {
      this.#running = undefined
    }))
    if (budgetMs === undefined) return running
    return Promise.race([
      running,
      new Promise<void>((resolve) => setTimeout(resolve, budgetMs).unref()),
    ])
  }

  async #run() {
    try {
      await this.#fill()
    } catch (error) {
      console.warn("[pico] search index:", error)
    }
  }

  async #fill() {
    const durable = this.#durable!
    try {
      this.#target =
        (
          durable.prepare("SELECT max(id) AS id FROM entries").get() as {
            id: number | null
          }
        ).id ?? 0
    } catch (error) {
      console.warn("[pico] search index: cannot read entries:", error)
      return
    }
    while (!this.#closed && this.#lastEntry < this.#target) {
      const started = Date.now()
      while (Date.now() - started < STEP_MS && this.#lastEntry < this.#target)
        if (!this.#step()) {
          this.#lastEntry = this.#target
          break
        }
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  /** Index one batch; false when there were no rows. */
  #step() {
    const rows = this.#readBatch!.all(this.#lastEntry) as Array<{
      id: number
      conversation: number
      data: string
    }>
    if (rows.length === 0) return false
    const db = this.#db!
    db.exec("BEGIN")
    try {
      for (const row of rows) {
        const indexed = entryRow(row.data)
        if (!indexed) continue
        this.#insertRow!.run(
          row.id,
          row.conversation,
          indexed.kind,
          indexed.ts ?? null,
          indexed.text
        )
        this.#insertText!.run(row.id, indexed.text)
      }
      this.#lastEntry = rows.at(-1)!.id
      db.prepare(
        "INSERT OR REPLACE INTO state (key, value) VALUES ('last_entry', ?)"
      ).run(this.#lastEntry)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
    return true
  }

  /**
   * The best hits for `query` (an FTS5 query; see `matchQuery`), best
   * first. Throws when search does not work.
   */
  search(query: string, limit: number): SearchHit[] {
    if (!this.#db) throw new Error(this.#error ?? "Search is not ready.")
    const rows = this.#db
      .prepare(
        `SELECT e.id AS entryId, e.conversation, e.kind, e.ts,
          snippet(entries_fts, 0, '${MATCH_START}', '${MATCH_END}', '…', 24) AS snippet,
          bm25(entries_fts) AS rank
        FROM entries_fts JOIN entries e ON e.id = entries_fts.rowid
        WHERE entries_fts MATCH ?
        ORDER BY rank LIMIT ?`
      )
      .all(query, limit) as Array<SearchHit & { ts: number | null }>
    return rows.map((row) => ({ ...row, ts: row.ts ?? undefined }))
  }

  /** An indexed entry, or undefined. */
  entry(entryId: number): IndexedEntry | undefined {
    const row = this.#db
      ?.prepare(
        "SELECT id AS entryId, conversation, kind, ts, text FROM entries WHERE id = ?"
      )
      .get(entryId) as (IndexedEntry & { ts: number | null }) | undefined
    return row ? { ...row, ts: row.ts ?? undefined } : undefined
  }

  /** The indexed entries of a conversation around `entryId`, in order. */
  around(
    conversation: number,
    entryId: number,
    before: number,
    after: number
  ): IndexedEntry[] {
    const db = this.#db
    if (!db) return []
    const earlier = db
      .prepare(
        "SELECT id AS entryId, conversation, kind, ts, text FROM entries WHERE conversation = ? AND id < ? ORDER BY id DESC LIMIT ?"
      )
      .all(conversation, entryId, before) as unknown as IndexedEntry[]
    const later = db
      .prepare(
        "SELECT id AS entryId, conversation, kind, ts, text FROM entries WHERE conversation = ? AND id >= ? ORDER BY id LIMIT ?"
      )
      .all(conversation, entryId, after + 1) as unknown as IndexedEntry[]
    return [...earlier.reverse(), ...later]
  }

  close() {
    this.#closed = true
    if (this.#timer) clearInterval(this.#timer)
    this.#durable?.close()
    this.#db?.close()
    this.#durable = undefined
    this.#db = undefined
  }
}
