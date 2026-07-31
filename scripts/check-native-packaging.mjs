#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const temporaryRoot = mkdtempSync(join(tmpdir(), "pico-native-packaging-"))
const homebrewRoot = join(temporaryRoot, "homebrew")
mkdirSync(homebrewRoot)

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  })
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr || `${command} failed`)
  }
  return result.stdout
}

try {
  for (const target of [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
  ]) {
    const asset = `pico-native-${packageJson.version}-${target}.tar.gz`
    writeFileSync(
      join(temporaryRoot, `${asset}.json`),
      JSON.stringify({
        version: packageJson.version,
        target,
        asset,
        sha256: "a".repeat(64),
        serverProtocolVersion: packageJson.pico.serverProtocolVersion,
        apiContractVersion: packageJson.pico.apiContractVersion,
      })
    )
  }
  run("node", ["scripts/generate-native-release-manifest.mjs", temporaryRoot])
  const dmg = join(temporaryRoot, "Pico.dmg")
  writeFileSync(dmg, "test DMG fixture")
  run("node", ["scripts/generate-homebrew-artifacts.mjs", temporaryRoot], {
    PICO_HOMEBREW_OUTPUT_DIR: homebrewRoot,
    PICO_MACOS_DMG: dmg,
  })
  const formula = join(homebrewRoot, "Formula", "pico.rb")
  const cask = join(homebrewRoot, "Casks", "pico.rb")
  run("ruby", ["-c", formula])
  run("ruby", ["-c", cask])
  const formulaText = readFileSync(formula, "utf8")
  for (const expected of [
    "service do",
    "keep_alive crashed: true",
    "linux-arm64",
  ]) {
    if (!formulaText.includes(expected)) {
      throw new Error(`generated Homebrew formula omitted ${expected}`)
    }
  }
  const caskText = readFileSync(cask, "utf8")
  for (const expected of ["preflight do", 'args: ["stop", "--wait"]']) {
    if (!caskText.includes(expected)) {
      throw new Error(`generated Homebrew cask omitted ${expected}`)
    }
  }
  console.log("Native release and Homebrew generation checks passed.")
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
