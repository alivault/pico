import assert from "node:assert/strict"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { createMcpExtension, type McpExtension } from "../src/extensions/mcp.ts"
import { tempDir } from "./support.ts"

const FIXTURE = fileURLToPath(
  new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url)
)

async function setup() {
  const dir = await tempDir()
  const agentDir = join(dir, "agent")
  await mkdir(agentDir)
  const log = join(dir, "pids.log")
  const server = (...tools: string[]) => ({
    command: process.execPath,
    args: [FIXTURE, log, ...tools],
    exposure: "direct",
  })
  // Write the file as editors do: a temporary file, then a rename.
  const writeConfig = async (mcpServers: Record<string, unknown>) => {
    const temporary = join(agentDir, "mcp.json.tmp")
    await writeFile(temporary, JSON.stringify({ mcpServers }))
    await rename(temporary, join(agentDir, "mcp.json"))
  }
  return { dir, agentDir, log, server, writeConfig }
}

/** Resolves when `check` is true, tested now and after each change event. */
function when(mcp: McpExtension, check: () => boolean) {
  return new Promise<void>((resolve) => {
    if (check()) resolve()
    mcp.onChange(() => {
      if (check()) resolve()
    })
  })
}

const toolNames = (mcp: McpExtension) =>
  (mcp.extension.tools ?? []).map((tool) => tool.name).sort()

/** The process ID of each connected server, from its instructions. */
const pids = (mcp: McpExtension) =>
  Object.fromEntries(
    mcp.namespaces().map((item) => [item.name, item.description])
  )

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function loggedPids(log: string) {
  const text = await readFile(log, "utf8").catch(() => "")
  return text.split("\n").filter(Boolean).map(Number)
}

void test("MCP reload adds, changes, and removes servers from mcp.json", async () => {
  const { dir, agentDir, log, server, writeConfig } = await setup()
  await writeConfig({ keep: server("one") })
  const mcp = createMcpExtension(agentDir, dir)
  try {
    await when(mcp, () => toolNames(mcp).length === 1)
    assert.deepEqual(toolNames(mcp), ["mcp__keep__one"])
    const keepPid = pids(mcp).mcp__keep
    assert.match(keepPid ?? "", /^pid \d+$/)

    // A new server connects; the unchanged one keeps its client.
    await writeConfig({ keep: server("one"), extra: server("two") })
    await mcp.reload()
    assert.deepEqual(toolNames(mcp), ["mcp__extra__two", "mcp__keep__one"])
    assert.equal(pids(mcp).mcp__keep, keepPid)
    const extraPid = pids(mcp).mcp__extra

    // A changed config connects again with the new config.
    await writeConfig({ keep: server("one"), extra: server("three") })
    await mcp.reload()
    assert.deepEqual(toolNames(mcp), ["mcp__extra__three", "mcp__keep__one"])
    assert.notEqual(pids(mcp).mcp__extra, extraPid)
    assert.equal(alive(Number(extraPid!.slice(4))), false)
    assert.equal(pids(mcp).mcp__keep, keepPid)

    // A file that does not parse keeps the current servers.
    await writeFile(join(agentDir, "mcp.json"), '{"mcpServers": {')
    await assert.rejects(mcp.reload(), /mcp\.json is not valid/)
    assert.deepEqual(toolNames(mcp), ["mcp__extra__three", "mcp__keep__one"])

    // A disabled server closes but stays in the list.
    await writeConfig({
      keep: server("one"),
      extra: { ...server("three"), enabled: false },
    })
    await mcp.reload()
    assert.deepEqual(toolNames(mcp), ["mcp__keep__one"])
    assert.deepEqual(
      mcp.status().map((item) => [item.name, item.connected]),
      [
        ["keep", true],
        ["extra", false],
      ]
    )

    // A removed server closes and leaves the list.
    await writeConfig({})
    await mcp.reload()
    assert.deepEqual(toolNames(mcp), [])
    assert.deepEqual(mcp.status(), [])
    assert.equal(alive(Number(keepPid!.slice(4))), false)
  } finally {
    await mcp.close()
  }
  for (const pid of await loggedPids(log)) assert.equal(alive(pid), false)
})

void test("MCP reloads at the same time do not leak servers", async () => {
  const { dir, agentDir, log, server, writeConfig } = await setup()
  await writeConfig({})
  const mcp = createMcpExtension(agentDir, dir)
  try {
    await writeConfig({ a: server("one") })
    const first = mcp.reload()
    await writeConfig({ a: server("two"), b: server("three") })
    await Promise.all([first, mcp.reload(), mcp.reload()])
    assert.deepEqual(toolNames(mcp), ["mcp__a__two", "mcp__b__three"])
    const running = (await loggedPids(log)).filter(alive)
    assert.equal(running.length, 2)
  } finally {
    await mcp.close()
  }
  for (const pid of await loggedPids(log)) assert.equal(alive(pid), false)
})

void test("MCP watches mcp.json and applies its changes", async () => {
  const { dir, agentDir, log, server, writeConfig } = await setup()
  const mcp = createMcpExtension(agentDir, dir)
  try {
    assert.deepEqual(mcp.status(), [])
    const added = when(mcp, () => toolNames(mcp).includes("mcp__live__one"))
    await writeConfig({ live: server("one") })
    await added
    const removed = when(mcp, () => toolNames(mcp).length === 0)
    await writeConfig({})
    await removed
    assert.deepEqual(mcp.status(), [])
  } finally {
    await mcp.close()
  }
  for (const pid of await loggedPids(log)) assert.equal(alive(pid), false)
})
