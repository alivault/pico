import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import type { IncomingMessage } from "node:http"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { test } from "node:test"

import { safeUploadName, saveUpload } from "../src/services/uploads.ts"
import { tempDir } from "./support.ts"

void test("an upload name is safe in a path", () => {
  assert.equal(safeUploadName("report 2024.pdf"), "report-2024.pdf")
  assert.equal(safeUploadName("../../etc/passwd"), "passwd")
  assert.equal(safeUploadName("C:\\Users\\me\\notes.txt"), "notes.txt")
  assert.equal(safeUploadName(".env"), "env")
  assert.equal(safeUploadName(""), "file")
})

void test("an upload is saved in the data directory", async () => {
  const data = await tempDir("pico-upload-test-")
  const body = Object.assign(Readable.from([Buffer.from("hello")]), {
    headers: {},
  }) as unknown as IncomingMessage
  const path = await saveUpload(data, "a b.txt", body)
  assert.equal(dirname(dirname(path)), join(data, "uploads"))
  assert.ok(path.endsWith("/a-b.txt"))
  assert.equal(await readFile(path, "utf8"), "hello")
})
