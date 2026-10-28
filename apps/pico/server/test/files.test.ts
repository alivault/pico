import assert from "node:assert/strict"
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import {
  projectTree,
  readProjectFile,
  writeProjectFile,
} from "../src/services/files.ts"
import { tempDir } from "./support.ts"

void test("workspace files reject traversal, escaped symlinks, and binary data", async () => {
  const root = await tempDir("pico-files-test-")
  const workspace = join(root, "workspace")
  await mkdir(workspace)
  await writeFile(join(workspace, "readme.md"), "hello")
  await writeFile(join(workspace, "binary"), Buffer.from([0, 1, 2]))
  await writeFile(join(root, "secret"), "outside")
  await symlink(join(root, "secret"), join(workspace, "escaped"))
  assert.equal((await readProjectFile(workspace, "readme.md")).content, "hello")
  await assert.rejects(readProjectFile(workspace, "../secret"), /inside/)
  await assert.rejects(readProjectFile(workspace, "escaped"), /inside/)
  await assert.rejects(readProjectFile(workspace, "binary"), /Binary/)
  assert.ok((await projectTree(workspace)).includes("readme.md"))
})

void test("workspace file saves keep the mode and stop on a conflict", async () => {
  const root = await tempDir("pico-files-write-test-")
  const workspace = join(root, "workspace")
  await mkdir(workspace)
  const file = join(workspace, "run.sh")
  await writeFile(file, "echo one\n", { mode: 0o755 })
  await writeFile(join(root, "secret"), "outside")
  await symlink(join(root, "secret"), join(workspace, "escaped"))

  const read = await readProjectFile(workspace, "run.sh")
  const saved = await writeProjectFile(
    workspace,
    "run.sh",
    "echo two\n",
    read.version
  )
  assert.equal(await readFile(file, "utf8"), "echo two\n")
  assert.equal((await stat(file)).mode & 0o777, 0o755)
  assert.equal(
    saved.version,
    (await readProjectFile(workspace, "run.sh")).version
  )

  await assert.rejects(
    writeProjectFile(workspace, "run.sh", "echo three\n", read.version),
    /changed on disk/
  )
  await writeProjectFile(workspace, "run.sh", "echo three\n", undefined)
  assert.equal(await readFile(file, "utf8"), "echo three\n")

  await assert.rejects(
    writeProjectFile(workspace, "../secret", "x", undefined),
    /inside/
  )
  await assert.rejects(
    writeProjectFile(workspace, "escaped", "x", undefined),
    /inside/
  )
  await assert.rejects(
    writeProjectFile(workspace, "missing.txt", "x", undefined),
    /not found/i
  )
  assert.equal(await readFile(join(root, "secret"), "utf8"), "outside")
})
