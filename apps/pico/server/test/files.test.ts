import assert from "node:assert/strict"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { projectTree, readProjectFile } from "../src/services/files.ts"
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
