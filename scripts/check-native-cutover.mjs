#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

function invariant(condition, message) {
  if (!condition) throw new Error(`Native cutover check failed: ${message}`)
}

for (const path of ["src/server", "src/nitro"]) {
  invariant(!existsSync(join(root, path)), `${path} must not exist`)
}
invariant(
  Object.keys(packageJson.dependencies ?? {}).length === 0,
  "the published npm launcher must have no production dependencies"
)
for (const dependency of ["node-pty", "nitro", "@tanstack/react-start"]) {
  invariant(
    !packageJson.dependencies?.[dependency] &&
      !packageJson.devDependencies?.[dependency],
    `${dependency} must be removed`
  )
}
invariant(
  packageJson.files?.includes(".output/public") &&
    !packageJson.files?.includes(".output"),
  "npm files must publish only the static browser output"
)

const browserRoutes = readdirSync(join(root, "src", "routes"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile())
  .map((entry) =>
    relative(join(root, "src", "routes"), join(entry.parentPath, entry.name))
  )
  .sort()
invariant(
  JSON.stringify(browserRoutes) === JSON.stringify(["__root.tsx", "index.tsx"]),
  `src/routes must remain browser-only (found ${browserRoutes.join(", ")})`
)
for (const path of ["index.html", "src/main.tsx"]) {
  invariant(existsSync(join(root, path)), `${path} is required for the SPA`)
}

const lockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8")
for (const marker of ["node-pty@", "nitro@", "@tanstack/react-start@"]) {
  invariant(!lockfile.includes(marker), `${marker} remains in pnpm-lock.yaml`)
}

console.log("Native server cutover checks passed.")
