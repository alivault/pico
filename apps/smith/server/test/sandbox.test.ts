import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { promisify } from "node:util"

import { findProfile } from "../src/core/profiles.ts"
import {
  overlayDirs,
  sandboxArgs,
  sandboxAvailable,
  sandboxExecution,
} from "../src/core/sandbox.ts"
import { tempDir } from "./support.ts"

const run = promisify(execFile)

void test("read-only and reviewer run bash in the sandbox", () => {
  assert.equal(findProfile("read-only")?.bash, "sandbox")
  assert.equal(findProfile("reviewer")?.bash, "sandbox")
  assert.equal(findProfile("builder")?.bash, undefined)
  assert.equal(findProfile("full")?.bash, undefined)
})

void test("overlays skip the home directory, nested directories, and directories with mounts", async () => {
  const home = await tempDir()
  for (const dir of [".cache", ".npm", "repo/sub", "fuse"])
    await mkdir(join(home, dir), { recursive: true })
  const mounts = ["/", join(home, "repo", "sub")]
  assert.deepEqual(overlayDirs(join(home, "repo"), { home, mounts }), [
    join(home, ".cache"),
    join(home, ".npm"),
  ])
  assert.deepEqual(overlayDirs(home, { home, mounts: ["/"] }), [
    join(home, ".cache"),
    join(home, ".npm"),
  ])
  assert.deepEqual(overlayDirs(join(home, ".cache"), { home, mounts: [] }), [
    join(home, ".cache"),
    join(home, ".npm"),
  ])
  assert.deepEqual(
    overlayDirs(join(home, "repo"), { home, mounts: [] }).slice(0, 1),
    [join(home, "repo")]
  )
})

void test("sandbox arguments: read-only root, no network, overlays", () => {
  const args = sandboxArgs("/work/repo", ["/work/repo"], 4242)
  assert.deepEqual(args.slice(0, 3), ["--ro-bind", "/", "/"])
  assert.ok(args.includes("--unshare-all"))
  assert.ok(!args.includes("--share-net"))
  const overlay = args.indexOf("--overlay-src")
  assert.deepEqual(args.slice(overlay, overlay + 4), [
    "--overlay-src",
    "/work/repo",
    "--tmp-overlay",
    "/work/repo",
  ])
  assert.equal(args.at(-1), "/work/repo")
})

void test(
  "a sandboxed command cannot keep a change or reach the network",
  { skip: !(await sandboxAvailable()) && "bubblewrap is not available" },
  async () => {
    const dir = await tempDir()
    await run("git", ["init", "-q", dir])
    await writeFile(join(dir, "file.txt"), "before\n")
    const execution = {
      command: [
        "echo changed > file.txt && cat file.txt",
        "echo new > created.txt && echo created",
        "echo x > /etc/pico-sandbox-test 2>/dev/null || echo outside-refused",
        "curl -s -m 3 http://example.com >/dev/null 2>&1 || echo no-network",
      ].join("\n"),
      cwd: dir,
      env: {} as Record<string, string>,
    }
    await sandboxExecution(execution)
    const { stdout } = await run("bash", ["-c", execution.command], {
      cwd: dir,
      env: { ...process.env, ...execution.env },
    })
    assert.match(stdout, /changed/)
    assert.match(stdout, /created/)
    assert.match(stdout, /outside-refused/)
    assert.match(stdout, /no-network/)
    // Nothing stays after the command ends.
    assert.equal((await run("cat", [join(dir, "file.txt")])).stdout, "before\n")
    assert.ok(!existsSync(join(dir, "created.txt")))
  }
)
