#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { access, mkdir, mkdtemp, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const ZIG_VERSION = "0.14.1"
const ZIG_RELEASES = {
  "darwin-arm64": {
    archive: `zig-aarch64-macos-${ZIG_VERSION}.tar.xz`,
    checksum:
      "39f3dc5e79c22088ce878edc821dedb4ca5a1cd9f5ef915e9b3cc3053e8faefa",
  },
  "darwin-x64": {
    archive: `zig-x86_64-macos-${ZIG_VERSION}.tar.xz`,
    checksum:
      "b0f8bdfb9035783db58dd6c19d7dea89892acc3814421853e5752fe4573e5f43",
  },
  "linux-arm64": {
    archive: `zig-aarch64-linux-${ZIG_VERSION}.tar.xz`,
    checksum:
      "f7a654acc967864f7a050ddacfaa778c7504a0eca8d2b678839c21eea47c992b",
  },
  "linux-x64": {
    archive: `zig-x86_64-linux-${ZIG_VERSION}.tar.xz`,
    checksum:
      "24aeeec8af16c381934a6cd7d95c807a8cb2cf7df9fa40d359aa884195c4716c",
  },
}

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))

function zigVersion(path) {
  const result = spawnSync(path, ["version"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : undefined
}

export async function ensureDesktopZig() {
  if (process.env.ZIG) {
    const version = zigVersion(process.env.ZIG)
    if (version !== ZIG_VERSION) {
      throw new Error(
        `ZIG points to version ${version ?? "unknown"}; Pico desktop requires ${ZIG_VERSION}`
      )
    }
    return process.env.ZIG
  }

  if (zigVersion("zig") === ZIG_VERSION) return "zig"

  const platformKey = `${process.platform}-${process.arch}`
  const release = ZIG_RELEASES[platformKey]
  if (!release) {
    throw new Error(
      `Pico cannot bootstrap Zig ${ZIG_VERSION} for ${platformKey}; set ZIG to a compatible binary`
    )
  }

  const installRoot = join(repoRoot, ".pico-dev", "zig")
  const installDirectory = join(installRoot, `${ZIG_VERSION}-${platformKey}`)
  const executable = join(installDirectory, "zig")
  if (zigVersion(executable) === ZIG_VERSION) return executable

  await mkdir(installRoot, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pico-desktop-zig-"))
  const archivePath = join(temporaryDirectory, release.archive)
  const url = `https://ziglang.org/download/${ZIG_VERSION}/${release.archive}`
  console.log(`[pico desktop] downloading Zig ${ZIG_VERSION}…`)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }

  const hash = createHash("sha256")
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body),
    hasher,
    createWriteStream(archivePath)
  )
  const checksum = hash.digest("hex")
  if (checksum !== release.checksum) {
    throw new Error(
      `Zig download checksum mismatch: expected ${release.checksum}, received ${checksum}`
    )
  }

  const extractedDirectory = join(
    temporaryDirectory,
    release.archive.replace(/\.tar\.xz$/, "")
  )
  const extracted = spawnSync(
    "tar",
    ["-xf", archivePath, "-C", temporaryDirectory],
    { stdio: "inherit" }
  )
  if (extracted.status !== 0) {
    throw new Error(`Failed to extract Zig ${ZIG_VERSION}`)
  }

  try {
    await rename(extractedDirectory, installDirectory)
  } catch (error) {
    try {
      await access(executable)
    } catch {
      throw error
    }
  }
  if (zigVersion(executable) !== ZIG_VERSION) {
    throw new Error(`Installed Zig binary is not version ${ZIG_VERSION}`)
  }
  return executable
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) {
    throw new Error("Expected a command to run")
  }
  const zig = await ensureDesktopZig()
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ZIG: zig },
  })
  child.on("error", (error) => {
    console.error(`[pico desktop] failed to run ${command}: ${error.message}`)
    process.exit(1)
  })
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[pico desktop] ${error.message}`)
    process.exit(1)
  })
}
