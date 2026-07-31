#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicDir = join(root, ".output", "public")
const shellPath = join(publicDir, "_shell.html")
if (!existsSync(shellPath)) {
  throw new Error(
    "TanStack SPA build did not produce .output/public/_shell.html"
  )
}
const shell = readFileSync(shellPath, "utf8")
if (!shell.startsWith("<!DOCTYPE html>")) {
  throw new Error("SPA shell is not a complete HTML document")
}
if (!shell.includes('type="module"')) {
  throw new Error("SPA shell does not contain a client module bootstrap")
}
const references = new Set(
  [...shell.matchAll(/\/assets\/[A-Za-z0-9_./-]+/g)].map((match) => match[0])
)
if (references.size === 0) {
  throw new Error("SPA shell does not reference any built assets")
}
for (const reference of references) {
  const path = join(publicDir, reference.slice(1))
  if (!existsSync(path)) {
    throw new Error(`SPA shell references a missing asset: ${reference}`)
  }
}
console.log(
  `Static SPA shell is valid (${references.size} directly referenced assets).`
)
