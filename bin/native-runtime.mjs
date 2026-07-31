import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

const TARGETS = {
  "darwin-arm64": {
    rust: "aarch64-apple-darwin",
    pi: "darwin-arm64",
  },
  "darwin-x64": {
    rust: "x86_64-apple-darwin",
    pi: "darwin-x64",
  },
  "linux-arm64": {
    rust: "aarch64-unknown-linux-gnu",
    pi: "linux-arm64",
  },
  "linux-x64": {
    rust: "x86_64-unknown-linux-gnu",
    pi: "linux-x64",
  },
}

export function nativeTarget() {
  const target = `${process.platform}-${process.arch}`
  if (!TARGETS[target]) {
    throw new Error(
      `Pico does not provide a native server for ${process.platform}/${process.arch}.`
    )
  }
  return target
}

export function nativeAssetName(version, target = nativeTarget()) {
  return `pico-native-${version}-${target}.tar.gz`
}

function defaultCacheRoot() {
  if (process.env.PICO_NATIVE_CACHE_DIR) {
    return resolve(process.env.PICO_NATIVE_CACHE_DIR)
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "Pico", "native")
  }
  return join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "pico",
    "native"
  )
}

function executablePath(root, name) {
  const path = join(root, name)
  return existsSync(path) ? path : undefined
}

function bundleAt(root, packageRoot) {
  const server = executablePath(root, "pico-server")
  if (!server) return undefined
  return {
    root,
    server,
    pi: process.env.PICO_PI_BIN || executablePath(root, "pi") || "pi",
    bridge:
      process.env.PICO_PI_BRIDGE_BIN || executablePath(root, "pico-pi-bridge"),
    web:
      process.env.PICO_WEB_DIR ||
      (existsSync(join(root, "web"))
        ? join(root, "web")
        : join(packageRoot, ".output", "public")),
  }
}

function explicitBundle(packageRoot) {
  const server = process.env.PICO_SERVER_BIN
  if (!server) return undefined
  const absoluteServer = resolve(server)
  if (!existsSync(absoluteServer)) {
    throw new Error(`PICO_SERVER_BIN does not exist: ${absoluteServer}`)
  }
  const root = dirname(absoluteServer)
  return {
    root,
    server: absoluteServer,
    pi: process.env.PICO_PI_BIN || executablePath(root, "pi") || "pi",
    bridge:
      process.env.PICO_PI_BRIDGE_BIN || executablePath(root, "pico-pi-bridge"),
    web: process.env.PICO_WEB_DIR || join(packageRoot, ".output", "public"),
  }
}

function developmentBundle(packageRoot, target) {
  const targetInfo = TARGETS[target]
  const serverCandidates = [
    join(packageRoot, "target", targetInfo.rust, "release"),
    join(packageRoot, "target", "release"),
    join(packageRoot, "target", targetInfo.rust, "debug"),
    join(packageRoot, "target", "debug"),
  ]
  const root = serverCandidates.find((candidate) =>
    existsSync(join(candidate, "pico-server"))
  )
  if (!root) return undefined

  const packageJson = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  )
  const piVersion =
    packageJson.dependencies?.["@earendil-works/pi-coding-agent"]
  const piArtifact = piVersion
    ? join(packageRoot, "artifacts", "pi", piVersion, targetInfo.pi, "pi", "pi")
    : undefined
  return {
    root,
    server: join(root, "pico-server"),
    pi:
      process.env.PICO_PI_BIN ||
      (piArtifact && existsSync(piArtifact) ? piArtifact : "pi"),
    bridge:
      process.env.PICO_PI_BRIDGE_BIN ||
      (existsSync(join(packageRoot, "target", "pico-pi-bridge"))
        ? join(packageRoot, "target", "pico-pi-bridge")
        : undefined),
    web: process.env.PICO_WEB_DIR || join(packageRoot, ".output", "public"),
  }
}

function releaseBaseUrl(version) {
  return (
    process.env.PICO_NATIVE_RELEASE_URL ||
    `https://github.com/alivault/pico/releases/download/v${version}`
  ).replace(/\/$/, "")
}

async function download(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "pico-app-native-launcher" },
    redirect: "follow",
  })
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function installDownloadedBundle(packageRoot, version, target) {
  const destination = join(defaultCacheRoot(), version, target)
  const existing = bundleAt(destination, packageRoot)
  if (existing) return existing

  const asset = nativeAssetName(version, target)
  const baseUrl = releaseBaseUrl(version)
  const [archive, checksumFile] = await Promise.all([
    download(`${baseUrl}/${asset}`),
    download(`${baseUrl}/${asset}.sha256`),
  ])
  const expectedChecksum = checksumFile.toString("utf8").trim().split(/\s+/)[0]
  if (!/^[a-f\d]{64}$/i.test(expectedChecksum)) {
    throw new Error(`Release checksum is invalid for ${asset}`)
  }
  const actualChecksum = createHash("sha256").update(archive).digest("hex")
  if (actualChecksum !== expectedChecksum.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expectedChecksum}, got ${actualChecksum}`
    )
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "pico-native-"))
  const archivePath = join(temporaryRoot, asset)
  const extracted = join(temporaryRoot, "bundle")
  mkdirSync(extracted)
  writeFileSync(archivePath, archive)
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", extracted], {
    stdio: "inherit",
  })
  if (result.error || result.status !== 0) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw result.error || new Error(`Could not extract ${asset}`)
  }
  for (const name of ["pico-server", "pi", "pico-pi-bridge"]) {
    const path = join(extracted, name)
    if (!existsSync(path)) {
      rmSync(temporaryRoot, { recursive: true, force: true })
      throw new Error(`${asset} is missing ${name}`)
    }
    chmodSync(path, 0o755)
  }
  if (!existsSync(join(extracted, "web"))) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw new Error(`${asset} is missing browser assets`)
  }

  mkdirSync(dirname(destination), { recursive: true })
  try {
    renameSync(extracted, destination)
  } catch (error) {
    if (!bundleAt(destination, packageRoot)) {
      rmSync(temporaryRoot, { recursive: true, force: true })
      throw error
    }
  }
  rmSync(temporaryRoot, { recursive: true, force: true })
  return bundleAt(destination, packageRoot)
}

export async function resolveNativeBundle(packageRoot, version) {
  const target = nativeTarget()
  if (process.env.PICO_FORCE_NATIVE_DOWNLOAD !== "1") {
    const explicit = explicitBundle(packageRoot)
    if (explicit) return explicit

    const packaged = bundleAt(join(packageRoot, "native", target), packageRoot)
    if (packaged) return packaged

    const development = developmentBundle(packageRoot, target)
    if (development) return development
  }

  if (process.env.PICO_DISABLE_NATIVE_DOWNLOAD === "1") {
    throw new Error(
      `Pico native server ${target} is not installed and downloads are disabled.`
    )
  }
  console.log(`Downloading Pico native server ${version} for ${target}...`)
  return installDownloadedBundle(packageRoot, version, target)
}

export async function fetchLatestNativeManifest() {
  const url =
    process.env.PICO_NATIVE_MANIFEST_URL ||
    "https://github.com/alivault/pico/releases/latest/download/pico-native-manifest.json"
  const response = await fetch(url, {
    headers: { "user-agent": "pico-app-native-launcher" },
    redirect: "follow",
  })
  if (!response.ok) {
    throw new Error(
      `Could not check the latest native Pico release: HTTP ${response.status}`
    )
  }
  const manifest = await response.json()
  if (
    typeof manifest?.version !== "string" ||
    !Number.isInteger(manifest?.serverProtocolVersion) ||
    !Number.isInteger(manifest?.apiContractVersion)
  ) {
    throw new Error("The native Pico release manifest is invalid.")
  }
  return manifest
}

export function nativeBundleSummary(bundle) {
  return `${basename(bundle.server)} (${bundle.root})`
}
