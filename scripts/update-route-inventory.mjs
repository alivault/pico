#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const apiPath = join(root, "crates", "pico-server", "src", "api.rs")
const outputPath = join(
  root,
  "apps",
  "apple",
  "Fixtures",
  "route_inventory.json"
)

export async function currentRouteInventory() {
  const source = await readFile(apiPath, "utf8")
  const routerSource = source.match(
    /fn router\(context: ServerContext\) -> Router \{([\s\S]*?)\.fallback\(spa_fallback\)/
  )?.[1]
  if (!routerSource) throw new Error("Could not find the Rust API router")

  const routes = []
  const matches = routerSource.matchAll(
    /\.route\(\s*"([^"]+)"([\s\S]*?)(?=\n\s*\.route\(|\n\s*\.fallback\()/g
  )
  for (const match of matches) {
    const path = match[1].replaceAll(/:([A-Za-z0-9_]+)/g, "$$$1")
    if (path === "/api/system/health" || path.startsWith("/api/rust/")) {
      continue
    }
    const methods = Array.from(
      match[2].matchAll(/\b(get|post|put|patch|delete)\s*\(/g),
      (method) => method[1].toUpperCase()
    )
    for (const method of new Set(methods)) routes.push({ method, path })
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
  console.log(`Wrote ${inventory.length} Rust routes to ${outputPath}`)
}
