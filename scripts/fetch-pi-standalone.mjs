#!/usr/bin/env node

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8")
)
const version =
  process.env.PI_STANDALONE_VERSION ||
  packageJson.devDependencies?.["@earendil-works/pi-coding-agent"]

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error("Set PI_STANDALONE_VERSION to a released Pi version")
}

const requestedTarget = process.env.PI_STANDALONE_TARGET
const [requestedPlatform, requestedArchitecture] = requestedTarget?.split(
  "-",
  2
) ?? [undefined, undefined]
const platform =
  requestedPlatform ?? { darwin: "darwin", linux: "linux" }[process.platform]
const architecture =
  requestedArchitecture ?? { arm64: "arm64", x64: "x64" }[process.arch]
if (
  !["darwin", "linux"].includes(platform ?? "") ||
  !["arm64", "x64"].includes(architecture ?? "")
) {
  throw new Error(
    `Unsupported standalone Pi target: ${requestedTarget ?? `${process.platform}/${process.arch}`}`
  )
}

const asset = `pi-${platform}-${architecture}.tar.gz`
const releaseBase = `https://github.com/earendil-works/pi/releases/download/v${version}`
const output = join(
  root,
  "artifacts",
  "pi",
  version,
  `${platform}-${architecture}`
)
const archivePath = join(output, asset)
const binaryPath = join(
  output,
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi"
)

try {
  const binary = await stat(binaryPath)
  if (binary.isFile()) {
    console.log(binaryPath)
    process.exit(0)
  }
} catch {
  // Download below.
}

await mkdir(output, { recursive: true })
const [archiveResponse, checksumsResponse] = await Promise.all([
  fetch(`${releaseBase}/${asset}`),
  fetch(`${releaseBase}/SHA256SUMS`),
])
if (!archiveResponse.ok) {
  throw new Error(`Failed to download ${asset}: HTTP ${archiveResponse.status}`)
}
if (!checksumsResponse.ok) {
  throw new Error(
    `Failed to download SHA256SUMS: HTTP ${checksumsResponse.status}`
  )
}

const archive = Buffer.from(await archiveResponse.arrayBuffer())
const checksums = await checksumsResponse.text()
const expected = checksums
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts.at(-1) === asset)?.[0]
if (!expected) throw new Error(`SHA256SUMS does not contain ${asset}`)

const actual = createHash("sha256").update(archive).digest("hex")
if (actual !== expected.toLowerCase()) {
  throw new Error(
    `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`
  )
}

await writeFile(archivePath, archive)
await execFileAsync("tar", ["-xzf", archivePath, "-C", output])
await chmod(binaryPath, 0o755)
console.log(binaryPath)
