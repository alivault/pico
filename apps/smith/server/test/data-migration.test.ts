/**
 * The one-time move of an old Pico data directory (`~/.pico`) to
 * `~/.smith`, and `smith move-project`. Each test builds its own home
 * folder, database, and git worktree in a temporary folder.
 */
import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { createRegistry, defineDoc, Harness } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { AgentMetaDoc, type AgentMeta } from "../src/core/agents.ts"
import {
  finishLegacyMigration,
  legacyDataDirFor,
  legacyMigrationInProgress,
  moveLegacyDataDir,
  replacePathPrefix,
  rewriteStoredPaths,
} from "../src/services/data-migration.ts"
import { tempDir } from "./support.ts"

/** The agent document as an old Pico stored it. */
const LegacyMetaDoc = defineDoc<AgentMeta>({
  kind: "pico.session",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    cwd: "",
    createdAt: 0,
    modifiedAt: 0,
    firstMessage: "",
    messageCount: 0,
  }),
})

function git(cwd: string, args: string[]) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" }
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

/** A git repository with one commit, and a worktree of it at `worktree`. */
function repoWithWorktree(repo: string, worktree: string) {
  mkdirSync(repo, { recursive: true })
  git(repo, ["init", "-q", "-b", "main"])
  writeFileSync(join(repo, "README.md"), "test\n")
  git(repo, ["add", "."])
  git(repo, ["commit", "-q", "-m", "first"])
  mkdirSync(join(worktree, ".."), { recursive: true })
  git(repo, ["worktree", "add", "-q", "-b", "agent/test", worktree])
}

/** A database with one agent that works in `cwd`, with the given doc. */
async function databaseWithAgent(
  database: string,
  doc: typeof AgentMetaDoc,
  meta: Partial<AgentMeta> & { cwd: string }
) {
  const harness = await Harness.open(
    await openNodeSqliteStorage(database),
    { models: createModels(), registry: createRegistry() },
    ctx
  )
  try {
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { cwd: meta.cwd },
        init: async (tx, conversationId) => {
          Object.assign(await tx.doc(doc, conversationId), {
            name: "Old agent",
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            firstMessage: "Hello",
            messageCount: 1,
            ...meta,
          })
        },
      },
      ctx
    )
    return conversation.id
  } finally {
    await harness.close(ctx)
  }
}

/** A home folder with an old `.pico` data directory. */
async function legacyHome() {
  const home = realpathSync(await tempDir("smith-migrate-test-"))
  const legacy = join(home, ".pico")
  const repo = join(home, "code", "repo")
  const worktree = join(legacy, "worktrees", "repo", "test-abc123")
  repoWithWorktree(repo, worktree)
  await databaseWithAgent(join(legacy, "pico.sqlite"), LegacyMetaDoc, {
    cwd: worktree,
    group: repo,
    worktree: { repoRoot: repo, path: worktree, branch: "agent/test" },
  })
  mkdirSync(join(legacy, "browser"), { recursive: true })
  writeFileSync(
    join(legacy, "browser", "1.json"),
    JSON.stringify({ cwd: worktree, other: `${legacy}-other/x` })
  )
  writeFileSync(
    join(legacy, "notes.json"),
    JSON.stringify({ projects: [repo, legacy] })
  )
  return { home, legacy, data: join(home, ".smith"), repo, worktree }
}

function query<T>(database: string, sql: string) {
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

function documentKinds(database: string) {
  return query<{ kind: string }>(
    database,
    "SELECT DISTINCT kind FROM documents ORDER BY kind"
  ).map((row) => JSON.parse(row.kind) as string)
}

function revisionsText(database: string) {
  return query<{ content: string }>(
    database,
    "SELECT content FROM document_revisions"
  )
    .map((row) => row.content)
    .join("\n")
}

/** Whether git knows the worktree at `worktree`, from both sides. */
function assertWorktreeWorks(repo: string, worktree: string) {
  git(worktree, ["status", "--short"])
  const list = git(repo, ["worktree", "list", "--porcelain"])
  assert.ok(
    list.includes(`worktree ${realpathSync(worktree)}`),
    `${list} lists ${worktree}`
  )
  assert.doesNotMatch(git(repo, ["worktree", "list"]), /prunable/)
}

type Server = { child: ChildProcess; url: string; output: () => string }

async function startServer(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<Server> {
  const child = spawn(
    process.execPath,
    [
      "dist/smith-server.mjs",
      "serve",
      "--port",
      "0",
      "--web-dir",
      "none",
      ...args,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  )
  let output = ""
  child.stdout!.on("data", (chunk) => (output += chunk.toString()))
  child.stderr!.on("data", (chunk) => (output += chunk.toString()))
  for (let i = 0; i < 300; i++) {
    const running = /is running at (http:\/\/\S+)/.exec(output)
    if (running) return { child, url: running[1]!, output: () => output }
    if (child.exitCode !== null) throw new Error(output)
    await new Promise((done) => setTimeout(done, 100))
  }
  child.kill("SIGTERM")
  throw new Error(`The server did not start:\n${output}`)
}

async function stopServer(server: Server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return
  const exited = new Promise((done) => server.child.once("exit", done))
  server.child.kill("SIGTERM")
  await exited
}

function serverEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PI_CODING_AGENT_DIR: join(home, "agent"),
  }
  delete env.SMITH_HOME
  delete env.SMITH_SUPERVISED
  return env
}

void test("a path prefix changes only whole path parts", () => {
  assert.equal(
    replacePathPrefix(
      '["/a/pico","/a/pico/x","/a/pico-x","/b/a/pico"]',
      "/a/pico",
      "/a/smith"
    ),
    '["/a/smith","/a/smith/x","/a/pico-x","/b/a/pico"]'
  )
  assert.equal(
    replacePathPrefix('{"v":"[\\"/a/pico/x\\"]"}', "/a/pico", "/a/smith"),
    '{"v":"[\\"/a/smith/x\\"]"}'
  )
})

void test("the first start moves ~/.pico to ~/.smith", async () => {
  const { home, legacy, data, repo } = await legacyHome()
  const server = await startServer([], serverEnv(home))
  try {
    assert.equal(existsSync(legacy), false)
    assert.equal(existsSync(join(data, "smith.sqlite")), true)
    assert.equal(existsSync(join(data, "pico.sqlite")), false)
    assert.equal(existsSync(join(data, ".migrated-from-pico")), true)
    assert.equal(legacyMigrationInProgress(data), false)
    assert.match(server.output(), /\[smith\] data: moved .*\.pico to .*\.smith/)
    assert.match(server.output(), /repaired the worktree/)

    const newWorktree = join(data, "worktrees", "repo", "test-abc123")
    assertWorktreeWorks(repo, newWorktree)

    // The server reads the renamed agent document with its new cwd.
    const response = (await (
      await fetch(
        `${server.url}/api/project-agents?project=${encodeURIComponent(repo)}`
      )
    ).json()) as { totalCount: number; agents: Array<{ cwd: string }> }
    assert.equal(response.totalCount, 1)
    assert.equal(response.agents[0]!.cwd, newWorktree)

    const browser = JSON.parse(
      readFileSync(join(data, "browser", "1.json"), "utf8")
    ) as { cwd: string; other: string }
    assert.equal(browser.cwd, newWorktree)
    assert.equal(browser.other, `${legacy}-other/x`)
    assert.deepEqual(
      JSON.parse(readFileSync(join(data, "notes.json"), "utf8")),
      { projects: [repo, data] }
    )
  } finally {
    await stopServer(server)
  }
  const database = join(data, "smith.sqlite")
  assert.ok(!documentKinds(database).some((kind) => kind.startsWith("pico.")))
  assert.ok(documentKinds(database).includes("smith.session"))
  assert.doesNotMatch(revisionsText(database), /\/\.pico\//)
})

void test("an interrupted move finishes, and a second run changes nothing", async () => {
  const { home, legacy, data, repo } = await legacyHome()
  const lines: string[] = []
  const log = (line: string) => lines.push(line)
  assert.equal(legacyDataDirFor(data, home), legacy)
  await moveLegacyDataDir(legacy, data, log)
  // Stopped after the folder moved and the database got its new name.
  assert.equal(legacyMigrationInProgress(data), true)
  assert.equal(legacyDataDirFor(data, home), undefined)
  renameSync(join(data, "pico.sqlite"), join(data, "smith.sqlite"))

  finishLegacyMigration(data, log)
  assert.equal(legacyMigrationInProgress(data), false)
  assert.equal(existsSync(join(data, ".migrated-from-pico")), true)
  const database = join(data, "smith.sqlite")
  assert.ok(documentKinds(database).includes("smith.session"))
  assert.ok(!documentKinds(database).includes("pico.session"))
  const text = revisionsText(database)
  assert.doesNotMatch(text, /\/\.pico\//)
  assert.match(text, /\/\.smith\/worktrees\/repo\/test-abc123/)
  assertWorktreeWorks(repo, join(data, "worktrees", "repo", "test-abc123"))

  const again = rewriteStoredPaths(data, legacy, data)
  assert.deepEqual(again, { documents: 0, tasks: 0, files: [] })
  assert.equal(legacyDataDirFor(data, home), undefined)
})

void test("no move when ~/.smith exists or another data directory is set", async () => {
  const { home, legacy, data } = await legacyHome()
  assert.equal(legacyDataDirFor(join(home, "other"), home), undefined)
  assert.equal(legacyDataDirFor(legacy, home), undefined)

  // The server with --data-dir elsewhere leaves ~/.pico alone.
  const other = join(home, "other")
  const server = await startServer(["--data-dir", other], serverEnv(home))
  await stopServer(server)
  assert.equal(existsSync(join(legacy, "pico.sqlite")), true)
  assert.equal(existsSync(data), false)

  mkdirSync(data)
  assert.equal(legacyDataDirFor(data, home), undefined)
  const second = await startServer([], serverEnv(home))
  await stopServer(second)
  assert.equal(existsSync(join(legacy, "pico.sqlite")), true)
  assert.doesNotMatch(second.output(), /\[smith\] data:/)
})

/** A data directory with an agent in a worktree of `<home>/code/old`. */
async function projectData() {
  const home = realpathSync(await tempDir("smith-move-test-"))
  const data = join(home, "data")
  const from = join(home, "code", "old")
  const to = join(home, "code", "new")
  const worktree = join(data, "worktrees", "old", "test-abc123")
  repoWithWorktree(from, worktree)
  await databaseWithAgent(join(data, "smith.sqlite"), AgentMetaDoc, {
    cwd: worktree,
    group: from,
    worktree: { repoRoot: from, path: worktree, branch: "agent/test" },
  })
  await databaseWithAgent(join(data, "smith.sqlite"), AgentMetaDoc, {
    cwd: join(from, "packages", "a"),
  })
  writeFileSync(
    join(data, "sidebar.json"),
    JSON.stringify({ projects: [from, `${from}-other`] })
  )
  renameSync(from, to)
  return { home, data, from, to, worktree }
}

function moveProject(home: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["dist/smith-server.mjs", "move-project", ...args],
    { env: serverEnv(home), encoding: "utf8", timeout: 120_000 }
  )
}

function assertMoved(data: string, from: string, to: string) {
  const text = revisionsText(join(data, "smith.sqlite"))
  assert.ok(!text.includes(`${from}/`) && !text.includes(`"${from}"`), text)
  assert.ok(text.includes(`"${to}"`))
  assert.ok(text.includes(`${to}/packages/a`))
  assert.deepEqual(
    JSON.parse(readFileSync(join(data, "sidebar.json"), "utf8")),
    { projects: [to, `${from}-other`] }
  )
}

void test("move-project rewrites paths and repairs worktrees", async () => {
  const { home, data, from, to, worktree } = await projectData()
  const result = moveProject(home, [from, to, "--data-dir", data])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /moved the project/)
  assert.match(result.stdout, /repaired the worktree/)
  assertMoved(data, from, to)
  assertWorktreeWorks(to, worktree)
})

void test("move-project goes through a running server", async () => {
  const { home, data, from, to, worktree } = await projectData()
  // A launcher: start the server again when it asks for a restart.
  const env = { ...serverEnv(home), SMITH_SUPERVISED: "1" }
  let server: Server = await startServer(["--data-dir", data], env)
  let restarted: Promise<Server> | undefined
  server.child.once("exit", (code) => {
    if (code === 75) restarted = startServer(["--data-dir", data], env)
  })
  try {
    const child = spawn(
      process.execPath,
      ["dist/smith-server.mjs", "move-project", from, to, "--data-dir", data],
      { env: serverEnv(home), stdio: ["ignore", "pipe", "pipe"] }
    )
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk.toString()))
    child.stderr.on("data", (chunk) => (output += chunk.toString()))
    const code = await new Promise((done) => child.once("exit", done))
    assert.equal(code, 0, output)
    assert.match(output, /restarts to rewrite the paths/)
    assert.match(output, /moved the project/)
    assert.ok(restarted)
    server = await restarted
    assertWorktreeWorks(to, worktree)
    const response = (await (
      await fetch(
        `${server.url}/api/project-agents?project=${encodeURIComponent(to)}`
      )
    ).json()) as { totalCount: number }
    assert.equal(response.totalCount, 1)
  } finally {
    await stopServer(server)
  }
  assertMoved(data, from, to)
})
