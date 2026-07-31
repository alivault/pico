#!/usr/bin/env node

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const releaseRoot = resolve(
  root,
  process.env.PICO_NATIVE_RELEASE_DIR ?? process.argv[2] ?? "dist/native"
)
const outputRoot = resolve(
  root,
  process.env.PICO_HOMEBREW_OUTPUT_DIR ?? "dist/homebrew"
)
const manifest = JSON.parse(
  readFileSync(join(releaseRoot, "pico-native-manifest.json"), "utf8")
)
const releaseUrl = `https://github.com/alivault/pico/releases/download/v${manifest.version}`
const requiredTargets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
]
for (const target of requiredTargets) {
  if (!manifest.assets?.[target]) {
    throw new Error(`Native release manifest is missing ${target}`)
  }
}

let formula = readFileSync(
  join(root, "packaging/homebrew/Formula/pico.rb.template"),
  "utf8"
).replaceAll("{{VERSION}}", manifest.version)
for (const target of requiredTargets) {
  const key = target.replaceAll("-", "_").toUpperCase()
  const asset = manifest.assets[target]
  formula = formula
    .replaceAll(`{{${key}_URL}}`, `${releaseUrl}/${asset.asset}`)
    .replaceAll(`{{${key}_SHA256}}`, asset.sha256)
}
mkdirSync(join(outputRoot, "Formula"), { recursive: true })
writeFileSync(join(outputRoot, "Formula", "pico.rb"), formula)

const dmgPath = process.env.PICO_MACOS_DMG
if (dmgPath) {
  const absoluteDmgPath = resolve(dmgPath)
  if (!existsSync(absoluteDmgPath)) {
    throw new Error(`PICO_MACOS_DMG does not exist: ${absoluteDmgPath}`)
  }
  const checksum = createHash("sha256")
    .update(readFileSync(absoluteDmgPath))
    .digest("hex")
  const cask = readFileSync(
    join(root, "packaging/homebrew/Casks/pico.rb.template"),
    "utf8"
  )
    .replaceAll("{{VERSION}}", manifest.version)
    .replaceAll("{{DMG_SHA256}}", checksum)
  mkdirSync(join(outputRoot, "Casks"), { recursive: true })
  writeFileSync(join(outputRoot, "Casks", "pico.rb"), cask)
}

console.log(`Generated Homebrew artifacts in ${outputRoot}`)
