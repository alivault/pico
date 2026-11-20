/**
 * Data that names old paths, and the one-time move from Pico to Smith.
 *
 * Smith was called Pico. Its data directory was `~/.pico`, its database
 * `pico.sqlite`, and its durable kinds `pico.*`. On the first start of a
 * server that owns the default data directory (`~/.smith`), when only
 * `~/.pico` exists:
 *
 *   1. With the lock of `~/.pico` (no old Pico runs), stop its pty-host,
 *      write `.migrating-from-pico`, and rename `~/.pico` to `~/.smith`.
 *      A rename across file systems fails with a message: the data can be
 *      large, so Smith does not copy it.
 *   2. With the lock of `~/.smith`: rename `pico.*` and `pico-*` files,
 *      rename the `pico.*` kinds in the database, rewrite stored paths
 *      under `~/.pico` (database documents, open tasks, JSON files), and
 *      run `git worktree repair` in each worktree under `worktrees/`.
 *   3. Replace `.migrating-from-pico` with `.migrated-from-pico`.
 *
 * Each step can run again, so a start after an interrupted move finishes
 * it. `smith move-project` uses the same path rewrite (see
 * `moveProjectPaths`) when the user moves a project folder.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { stopPtyHost } from "../pty-host/client.ts"

/** The old product name, as it appears in old data. */
const LEGACY_NAME = "pico"
const LEGACY_DIR_NAME = `.${LEGACY_NAME}`
const DATA_DIR_NAME = ".smith"
const IN_PROGRESS_FILE = `.migrating-from-${LEGACY_NAME}`
const DONE_FILE = `.migrated-from-${LEGACY_NAME}`
const DATABASE_FILE = "smith.sqlite"

type Log = (message: string) => void

type InProgress = { from: string; to: string; startedAt: string }

/** What a path rewrite changed. */
export type PathRewriteResult = {
  documents: number
  tasks: number
  files: string[]
}

/**
 * The old data directory to move into `dataDir`, or undefined. Only the
 * default data directory (`~/.smith`) moves, only when it does not exist
 * yet, and only when `~/.pico` exists.
 */
export function legacyDataDirFor(dataDir: string, home = homedir()) {
  if (resolve(dataDir) !== join(home, DATA_DIR_NAME)) return undefined
  const legacy = join(home, LEGACY_DIR_NAME)
  if (existsSync(dataDir) || !existsSync(legacy)) return undefined
  return legacy
}

/** Whether a move into `dataDir` started and did not finish. */
export function legacyMigrationInProgress(dataDir: string) {
  return existsSync(join(dataDir, IN_PROGRESS_FILE))
}

/**
 * Step 1: rename the old data directory. The caller holds the lock of
 * `legacy`; the lock file moves with the directory.
 */
export async function moveLegacyDataDir(
  legacy: string,
  dataDir: string,
  log: Log
) {
  // The old pty-host writes job logs into its data directory, and would
  // make `~/.pico` again. Its terminals and jobs end.
  const ptyHost = await stopPtyHost(legacy).catch(() => undefined)
  if (ptyHost)
    log(`stopped the old pty-host (pid ${ptyHost}); its terminals ended`)
  const marker = join(legacy, IN_PROGRESS_FILE)
  if (!existsSync(marker)) {
    const state: InProgress = {
      from: legacy,
      to: dataDir,
      startedAt: new Date().toISOString(),
    }
    writeFileSync(marker, `${JSON.stringify(state, null, 2)}\n`)
  }
  try {
    renameSync(legacy, dataDir)
  } catch (error) {
    try {
      unlinkSync(marker)
    } catch {
      // Keep the error below.
    }
    if ((error as NodeJS.ErrnoException).code === "EXDEV")
      throw new Error(
        `Cannot move ${legacy} to ${dataDir}: they are on different file systems, and Smith does not copy the data. Move the folder yourself (mv ${legacy} ${dataDir}), then start Smith again.`
      )
    throw error
  }
  log(`moved ${legacy} to ${dataDir}`)
}

/**
 * Steps 2 and 3: finish a move into `dataDir`. The caller holds the lock
 * of `dataDir`, and no database connection is open. It can run again.
 */
export function finishLegacyMigration(dataDir: string, log: Log) {
  const markerFile = join(dataDir, IN_PROGRESS_FILE)
  const marker = JSON.parse(readFileSync(markerFile, "utf8")) as InProgress
  const from = marker.from
  for (const [old, next] of renameLegacyFiles(dataDir))
    log(`renamed ${old} to ${next}`)
  const database = join(dataDir, DATABASE_FILE)
  if (existsSync(database)) {
    const kinds = renameLegacyKinds(database)
    log(
      `renamed the ${LEGACY_NAME}.* kinds: ${kinds.documents} documents, ${kinds.tasks} tasks, ${kinds.entries} entries`
    )
  }
  const paths = rewriteStoredPaths(dataDir, from, dataDir)
  log(
    `rewrote ${from} paths: ${paths.documents} document revisions, ${paths.tasks} tasks, ${paths.files.length} files`
  )
  for (const result of repairDataDirWorktrees(dataDir))
    log(
      result.ok
        ? `repaired the worktree ${result.path}`
        : `could not repair the worktree ${result.path}: ${result.error}`
    )
  writeFileSync(
    join(dataDir, DONE_FILE),
    `${JSON.stringify(
      { ...marker, finishedAt: new Date().toISOString() },
      null,
      2
    )}\n`
  )
  unlinkSync(markerFile)
  log(`the move from ${from} is done`)
}

/**
 * Rename `pico.*` and `pico-*` entries at the top of the data directory
 * (`pico.sqlite`, `-wal`, `-shm`) to `smith.*` and `smith-*`.
 */
function renameLegacyFiles(dataDir: string) {
  const renamed: Array<[string, string]> = []
  for (const name of readdirSync(dataDir)) {
    if (
      !name.startsWith(`${LEGACY_NAME}.`) &&
      !name.startsWith(`${LEGACY_NAME}-`)
    )
      continue
    const next = `smith${name.slice(LEGACY_NAME.length)}`
    if (existsSync(join(dataDir, next))) continue
    renameSync(join(dataDir, name), join(dataDir, next))
    renamed.push([name, next])
  }
  return renamed
}

/** `"pico.x"` → `"smith.x"` in a JSON string column. */
const KIND_COLUMN = `'"smith.' || substr(kind, ${LEGACY_NAME.length + 3})`
const KIND_COLUMN_MATCH = `substr(kind, 1, ${LEGACY_NAME.length + 2}) = '"${LEGACY_NAME}.'`
/** `pico.x` → `smith.x` in the `kind` field of a JSON record. */
const KIND_FIELD = `json_set(record, '$.kind', 'smith.' || substr(json_extract(record, '$.kind'), ${LEGACY_NAME.length + 2}))`
const KIND_FIELD_MATCH = `substr(json_extract(record, '$.kind'), 1, ${LEGACY_NAME.length + 1}) = '${LEGACY_NAME}.'`

/** Rename the durable kinds `pico.*` to `smith.*` in one transaction. */
function renameLegacyKinds(database: string) {
  return withDatabase(database, (db) => {
    const documents = db
      .prepare(
        `UPDATE documents SET kind = ${KIND_COLUMN}, record = ${KIND_FIELD} WHERE ${KIND_COLUMN_MATCH}`
      )
      .run().changes
    const tasks = db
      .prepare(
        `UPDATE tasks SET kind = ${KIND_COLUMN}, record = ${KIND_FIELD} WHERE ${KIND_COLUMN_MATCH}`
      )
      .run().changes
    // Imported Pi sessions have `pico.legacy.*` entries.
    const entries = db
      .prepare(
        `UPDATE entries SET record = ${KIND_FIELD} WHERE ${KIND_FIELD_MATCH}`
      )
      .run().changes
    return {
      documents: Number(documents),
      tasks: Number(tasks),
      entries: Number(entries),
    }
  })
}

function withDatabase<T>(database: string, work: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(database)
  try {
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("BEGIN IMMEDIATE")
    try {
      const result = work(db)
      db.exec("COMMIT")
      return result
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  } finally {
    db.close()
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Replace the path `from` with `to` in a text where it is a whole path or
 * the start of one: `/a/pico` and `/a/pico/x` change; `/a/pico-x` and
 * `/b/a/pico` do not. Paths are JSON-escaped, for JSON text.
 */
export function replacePathPrefix(text: string, from: string, to: string) {
  const fromJson = JSON.stringify(from).slice(1, -1)
  const toJson = JSON.stringify(to).slice(1, -1)
  if (!text.includes(fromJson)) return text
  const pattern = new RegExp(
    `(?<![\\w.~/-])${escapeRegExp(fromJson)}(?![\\w.-])`,
    "g"
  )
  return text.replace(pattern, () => toJson)
}

/**
 * Rewrite stored paths that start with `from` to start with `to`: the
 * state documents in the database (agent and conversation cwd, sidebar
 * groups, worktrees, jobs), the tasks that did not end, and the JSON files
 * of the data directory (settings, sidebar, viewers, browser state). The
 * conversation history keeps the old text. No server may have the
 * database open.
 */
export function rewriteStoredPaths(
  dataDir: string,
  from: string,
  to: string
): PathRewriteResult {
  const result: PathRewriteResult = { documents: 0, tasks: 0, files: [] }
  if (resolve(from) === resolve(to)) return result
  const database = join(dataDir, DATABASE_FILE)
  if (existsSync(database))
    withDatabase(database, (db) => {
      const needle = JSON.stringify(from).slice(1, -1)
      const revisions = db
        .prepare(
          "SELECT document_id, seq, content FROM document_revisions WHERE instr(content, ?) > 0"
        )
        .all(needle) as Array<{
        document_id: number
        seq: number
        content: string
      }>
      const updateRevision = db.prepare(
        "UPDATE document_revisions SET content = ? WHERE document_id = ? AND seq = ?"
      )
      for (const row of revisions) {
        const next = replacePathPrefix(row.content, from, to)
        if (next === row.content) continue
        updateRevision.run(next, row.document_id, row.seq)
        result.documents += 1
      }
      const tasks = db
        .prepare(
          "SELECT id, record FROM tasks WHERE status != 'terminal' AND instr(record, ?) > 0"
        )
        .all(needle) as Array<{ id: number; record: string }>
      const updateTask = db.prepare("UPDATE tasks SET record = ? WHERE id = ?")
      for (const row of tasks) {
        const next = replacePathPrefix(row.record, from, to)
        if (next === row.record) continue
        updateTask.run(next, row.id)
        result.tasks += 1
      }
    })
  for (const file of stateJsonFiles(dataDir)) {
    let text: string
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const next = replacePathPrefix(text, from, to)
    if (next === text) continue
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, next, { mode: statSync(file).mode & 0o777 })
    renameSync(temporary, file)
    result.files.push(file)
  }
  return result
}

/**
 * The JSON files with state: at the top of the data directory, the agent
 * browser state, and the machine caches.
 */
function stateJsonFiles(dataDir: string) {
  const files: string[] = []
  const add = (dir: string) => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true }))
        if (entry.isFile() && entry.name.endsWith(".json"))
          files.push(join(dir, entry.name))
    } catch {
      // No such folder.
    }
  }
  add(dataDir)
  add(join(dataDir, "browser"))
  try {
    for (const entry of readdirSync(join(dataDir, "machines"), {
      withFileTypes: true,
    }))
      if (entry.isDirectory()) add(join(dataDir, "machines", entry.name))
  } catch {
    // No machines.
  }
  return files
}

/** The linked git worktrees under `<data>/worktrees/<repo>/<name>`. */
export function dataDirWorktrees(dataDir: string) {
  const root = join(dataDir, "worktrees")
  const found: Array<{ path: string; gitdir: string }> = []
  let repos: string[]
  try {
    repos = readdirSync(root)
  } catch {
    return found
  }
  for (const repo of repos) {
    let names: string[]
    try {
      names = readdirSync(join(root, repo))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(root, repo, name)
      try {
        const text = readFileSync(join(path, ".git"), "utf8")
        const match = /^gitdir:\s*(.+)$/m.exec(text)
        if (match) found.push({ path, gitdir: resolve(path, match[1]!.trim()) })
      } catch {
        // Not a linked worktree.
      }
    }
  }
  return found
}

type RepairResult = { path: string; ok: boolean; error?: string }

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  })
  if (result.error) return { ok: false, error: result.error.message }
  if (result.status !== 0)
    return {
      ok: false,
      error: (result.stderr || result.stdout || "").trim() || "git failed",
    }
  return { ok: true }
}

/**
 * After the data directory moved: in each worktree, `git worktree repair`
 * points the repository's back-link to the new worktree path.
 */
export function repairDataDirWorktrees(dataDir: string): RepairResult[] {
  return dataDirWorktrees(dataDir).map(({ path }) => ({
    path,
    ...git(path, ["worktree", "repair"]),
  }))
}

/** The repository root of a linked worktree's `gitdir`. */
function repoOfGitdir(gitdir: string) {
  const marker = `${join("/", ".git", "worktrees")}/`
  const index = gitdir.lastIndexOf(marker)
  if (index >= 0) return gitdir.slice(0, index)
  // A bare repository: <repo>/worktrees/<name>.
  return dirname(dirname(gitdir))
}

/** What `smith move-project` changed. */
export type MoveProjectResult = PathRewriteResult & {
  from: string
  to: string
  worktrees: RepairResult[]
}

/**
 * `smith move-project`: after the user moved a project folder from `from`
 * to `to`, rewrite the stored paths, and repair the repository's
 * worktrees under the data directory (from the moved repository, `git
 * worktree repair <worktree>` points each worktree to it). No server may
 * have the database open.
 */
export function moveProjectPaths(
  dataDir: string,
  from: string,
  to: string
): MoveProjectResult {
  const paths = rewriteStoredPaths(dataDir, from, to)
  // Git can store the real path (without symbolic links) of the folder.
  const real = (path: string) => {
    try {
      return join(realpathSync(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
  const byRepo = new Map<string, string[]>()
  for (const worktree of dataDirWorktrees(dataDir)) {
    let moved = replacePathPrefix(worktree.gitdir, from, to)
    if (moved === worktree.gitdir)
      moved = replacePathPrefix(worktree.gitdir, real(from), real(to))
    if (moved === worktree.gitdir) continue
    const repo = repoOfGitdir(moved)
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), worktree.path])
  }
  const worktrees: RepairResult[] = []
  for (const [repo, list] of byRepo) {
    const result = git(repo, ["worktree", "repair", ...list])
    for (const path of list) worktrees.push({ path, ...result })
  }
  return { from, to, ...paths, worktrees }
}

const PENDING_MOVES_FILE = "pending-project-moves.json"
const MOVE_RESULTS_FILE = "project-moves.json"

type PendingMove = { id: string; from: string; to: string }

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

/**
 * Ask the next server start to move a project (a running server cannot
 * rewrite its open database). Returns the ID of the move.
 */
export function queueProjectMove(dataDir: string, from: string, to: string) {
  const file = join(dataDir, PENDING_MOVES_FILE)
  const pending = readJsonFile<PendingMove[]>(file, [])
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  pending.push({ id, from, to })
  writeFileSync(file, `${JSON.stringify(pending, null, 2)}\n`)
  return id
}

/** The result of a queued move, after a server start applied it. */
export function projectMoveResult(dataDir: string, id: string) {
  return readJsonFile<Record<string, MoveProjectResult>>(
    join(dataDir, MOVE_RESULTS_FILE),
    {}
  )[id]
}

/** Apply the queued moves. The caller holds the lock; no database is open. */
export function applyQueuedProjectMoves(dataDir: string, log: Log) {
  const file = join(dataDir, PENDING_MOVES_FILE)
  const pending = readJsonFile<PendingMove[]>(file, [])
  if (!pending.length) return
  const resultsFile = join(dataDir, MOVE_RESULTS_FILE)
  for (const move of pending) {
    const result = moveProjectPaths(dataDir, move.from, move.to)
    logMoveResult(result, log)
    // Keep the last few results for `smith move-project`.
    const results = Object.entries(
      readJsonFile<Record<string, MoveProjectResult>>(resultsFile, {})
    ).slice(-9)
    writeFileSync(
      resultsFile,
      `${JSON.stringify(Object.fromEntries([...results, [move.id, result]]), null, 2)}\n`
    )
  }
  unlinkSync(file)
}

export function logMoveResult(result: MoveProjectResult, log: Log) {
  log(
    `moved the project ${result.from} to ${result.to}: ${result.documents} document revisions, ${result.tasks} tasks, ${result.files.length} files${result.files.length ? ` (${result.files.map((file) => basename(file)).join(", ")})` : ""}`
  )
  for (const worktree of result.worktrees)
    log(
      worktree.ok
        ? `repaired the worktree ${worktree.path}`
        : `could not repair the worktree ${worktree.path}: ${worktree.error}`
    )
}
