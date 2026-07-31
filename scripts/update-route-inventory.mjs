#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const routesDir = join(root, "src", "routes")
const outputPath = join(
  root,
  "apps",
  "apple",
  "Fixtures",
  "route_inventory.json"
)

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesBelow(path)))
    else if (/\.[jt]sx?$/.test(entry.name)) files.push(path)
  }
  return files
}

export async function currentRouteInventory() {
  const routes = []
  for (const path of await filesBelow(routesDir)) {
    const source = await readFile(path, "utf8")
    if (!source.includes("server:")) continue
    const route = source.match(/createFileRoute\("([^"]+)"\)/)?.[1]
    if (!route) continue
    const methods = Array.from(
      source.matchAll(/^\s+(GET|POST|PUT|PATCH|DELETE):/gm),
      (match) => match[1]
    )
    for (const method of new Set(methods)) {
      routes.push({ method, path: route })
    }
  }
  return routes.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = await currentRouteInventory()
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`)
  console.log(`Wrote ${inventory.length} routes to ${outputPath}`)
}
