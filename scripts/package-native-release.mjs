#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const cargoVersion = /^version = "([^"]+)"$/m.exec(
  readFileSync(join(root, "crates/pico-server/Cargo.toml"), "utf8")
)?.[1]
if (cargoVersion !== packageJson.version) {
  throw new Error(
    `Pico package version ${packageJson.version} does not match Rust server ${cargoVersion ?? "unknown"}`
  )
}
const targets = {
  "darwin-arm64": {
    rust: "aarch64-apple-darwin",
    bun: "bun-darwin-arm64",
  },
  "darwin-x64": {
    rust: "x86_64-apple-darwin",
    bun: "bun-darwin-x64",
  },
  "linux-arm64": {
    rust: "aarch64-unknown-linux-gnu",
    bun: "bun-linux-arm64",
  },
  "linux-x64": {
    rust: "x86_64-unknown-linux-gnu",
    bun: "bun-linux-x64",
  },
}

function readTarget() {
  const index = process.argv.indexOf("--target")
  const value =
    index >= 0 ? process.argv[index + 1] : process.env.PICO_NATIVE_TARGET
  if (!value || !targets[value]) {
    throw new Error(
      `Set --target to one of: ${Object.keys(targets).join(", ")}`
    )
  }
  return value
}

function run(command, args, options = {}) {
  console.log(`+ ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? "no status"}`)
  }
}

const target = readTarget()
const targetInfo = targets[target]
const version = packageJson.version
const outputRoot = resolve(
  root,
  process.env.PICO_NATIVE_RELEASE_DIR ?? "dist/native"
)
const workRoot = join(outputRoot, "work", target)
const staging = join(workRoot, "bundle")
const assetName = `pico-native-${version}-${target}.tar.gz`
const assetPath = join(outputRoot, assetName)
const bridgePath = join(workRoot, "pico-pi-bridge")

rmSync(workRoot, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
mkdirSync(outputRoot, { recursive: true })

if (process.env.PICO_SKIP_WEB_BUILD !== "1") {
  run("pnpm", ["build"])
}
run("rustup", ["target", "add", targetInfo.rust])
run("cargo", [
  "build",
  "--release",
  "--locked",
  "--target",
  targetInfo.rust,
  "-p",
  "pico-server",
])
run("pnpm", ["build:pi-bridge"], {
  env: {
    PICO_PI_BRIDGE_TARGET: targetInfo.bun,
    PICO_PI_BRIDGE_OUTPUT: bridgePath,
  },
})
run("node", ["scripts/fetch-pi-standalone.mjs"], {
  env: { PI_STANDALONE_TARGET: target },
})

const piVersion = packageJson.dependencies["@earendil-works/pi-coding-agent"]
const serverPath = join(
  root,
  "target",
  targetInfo.rust,
  "release",
  "pico-server"
)
const piPath = join(root, "artifacts", "pi", piVersion, target, "pi", "pi")
for (const [source, destination] of [
  [serverPath, join(staging, "pico-server")],
  [bridgePath, join(staging, "pico-pi-bridge")],
  [piPath, join(staging, "pi")],
]) {
  if (!existsSync(source)) throw new Error(`Missing native artifact: ${source}`)
  cpSync(source, destination)
  chmodSync(destination, 0o755)
}
cpSync(join(root, ".output", "public"), join(staging, "web"), {
  recursive: true,
})
cpSync(join(root, "LICENSE"), join(staging, "LICENSE"))

run("tar", ["-czf", assetPath, "-C", staging, "."])
const checksum = createHash("sha256")
  .update(readFileSync(assetPath))
  .digest("hex")
writeFileSync(
  join(outputRoot, `${assetName}.sha256`),
  `${checksum}  ${assetName}\n`
)
writeFileSync(
  join(outputRoot, `${assetName}.json`),
  `${JSON.stringify(
    {
      version,
      target,
      asset: assetName,
      sha256: checksum,
      serverProtocolVersion: packageJson.pico.serverProtocolVersion,
      apiContractVersion: packageJson.pico.apiContractVersion,
    },
    null,
    2
  )}\n`
)
console.log(`Packaged native release: ${assetPath}`)
