import assert from "node:assert/strict"
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import {
  projectFavicon,
  projectImageFile,
  projectTree,
  readProjectFile,
  writeProjectFile,
} from "../src/services/files.ts"
import { tempDir } from "./support.ts"

void test("workspace files reject traversal, escaped symlinks, and binary data", async () => {
  const root = await tempDir("smith-files-test-")
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
  // An absolute path names a file outside the project on purpose.
  const outside = await readProjectFile(workspace, join(root, "secret"))
  assert.equal(outside.content, "outside")
  assert.equal(outside.path, join(root, "secret"))
})

void test("image files have a version for the viewer, and only images are served raw", async () => {
  const workspace = await tempDir("smith-files-test-")
  // A 1×1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  )
  await writeFile(join(workspace, "dot.PNG"), png)
  await writeFile(join(workspace, "icon.svg"), "<svg/>")
  await writeFile(join(workspace, "notes.txt"), "text")

  const read = await readProjectFile(workspace, "dot.PNG")
  assert.deepEqual(read.image, { mimeType: "image/png", size: png.length })
  assert.equal(read.content, "")
  assert.ok(read.version)
  // A change of the file changes the version, so the viewer loads it again.
  await writeFile(join(workspace, "dot.PNG"), Buffer.concat([png, png]))
  assert.notEqual(
    (await readProjectFile(workspace, "dot.PNG")).version,
    read.version
  )

  // An SVG is text, and also an image.
  const svg = await readProjectFile(workspace, "icon.svg")
  assert.equal(svg.content, "<svg/>")
  assert.equal(svg.image, undefined)
  assert.equal(
    (await projectImageFile(workspace, "icon.svg")).mimeType,
    "image/svg+xml"
  )

  assert.equal(
    (await projectImageFile(workspace, "dot.PNG")).mimeType,
    "image/png"
  )
  await assert.rejects(projectImageFile(workspace, "notes.txt"), /images/)
  await assert.rejects(projectImageFile(workspace, "../dot.PNG"), /inside/)
})

void test("workspace file saves keep the mode and stop on a conflict", async () => {
  const root = await tempDir("smith-files-write-test-")
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

void test("a project favicon is found in its folder, or in a monorepo app", async () => {
  const plain = await tempDir("smith-files-test-")
  assert.equal(await projectFavicon(plain), null)

  const web = await tempDir("smith-files-test-")
  await mkdir(join(web, "public"))
  await writeFile(join(web, "public", "favicon.ico"), "ico")
  await writeFile(join(web, "public", "favicon.svg"), "<svg/>")
  // An SVG comes before an ICO in the same folder.
  assert.equal((await projectFavicon(web))?.path, "public/favicon.svg")

  const monorepo = await tempDir("smith-files-test-")
  await mkdir(join(monorepo, "apps", "web", "src", "app"), { recursive: true })
  await writeFile(
    join(monorepo, "apps", "web", "src", "app", "icon.png"),
    "png"
  )
  const favicon = await projectFavicon(monorepo)
  assert.equal(favicon?.path, "apps/web/src/app/icon.png")
  assert.match(favicon?.version ?? "", /^\d+-3$/)
})
