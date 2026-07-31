#!/usr/bin/env node

import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, "native", "pi-bridge.ts")
const output =
  process.env.PICO_PI_BRIDGE_OUTPUT || join(root, "target", "pico-pi-bridge")
const bun = process.env.BUN_BIN || "bun"
const target = process.env.PICO_PI_BRIDGE_TARGET
mkdirSync(dirname(output), { recursive: true })

const args = ["build", source, "--compile", "--outfile", output]
if (target) args.push("--target", target)
const result = spawnSync(bun, args, { cwd: root, stdio: "inherit" })
if (result.error) {
  console.error(
    `Failed to run ${bun}. Install Bun or set BUN_BIN to build the standalone Pico Pi bridge.`
  )
  throw result.error
}
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Built standalone Pi bridge: ${output}`)
