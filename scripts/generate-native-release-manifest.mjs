#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const input = resolve(
  root,
  process.env.PICO_NATIVE_RELEASE_DIR ?? process.argv[2] ?? "dist/native"
)
const records = readdirSync(input)
  .filter(
    (name) =>
      name !== "pico-native-manifest.json" &&
      /^pico-native-.+\.json$/.test(name)
  )
  .map((name) => JSON.parse(readFileSync(join(input, name), "utf8")))
  .sort((left, right) => left.target.localeCompare(right.target))

if (records.length === 0) {
  throw new Error(`No native release metadata found in ${input}`)
}
for (const record of records) {
  if (
    record.version !== packageJson.version ||
    record.serverProtocolVersion !== packageJson.pico.serverProtocolVersion ||
    record.apiContractVersion !== packageJson.pico.apiContractVersion
  ) {
    throw new Error(`Incompatible native release metadata for ${record.target}`)
  }
}

const manifest = {
  version: packageJson.version,
  serverProtocolVersion: packageJson.pico.serverProtocolVersion,
  apiContractVersion: packageJson.pico.apiContractVersion,
  assets: Object.fromEntries(
    records.map((record) => [
      record.target,
      { asset: record.asset, sha256: record.sha256 },
    ])
  ),
}
writeFileSync(
  join(input, "pico-native-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
)
console.log(`Generated native release manifest for ${records.length} targets.`)
