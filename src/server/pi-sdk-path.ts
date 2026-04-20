import fs from "node:fs"
import path from "node:path"

function resolveFromPathEnvironment() {
  const explicitPiBin = process.env.PI_REAL_PI_BIN
  if (explicitPiBin) {
    return path.dirname(path.dirname(fs.realpathSync(explicitPiBin)))
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue

    const candidate = path.join(dir, "pi")
    if (!fs.existsSync(candidate)) continue

    try {
      const resolved = fs.realpathSync(candidate)
      if (
        resolved.endsWith(
          path.join("@mariozechner", "pi-coding-agent", "dist", "cli.js")
        )
      ) {
        return path.dirname(path.dirname(resolved))
      }
    } catch {
      // ignore and keep scanning
    }
  }

  return undefined
}

function resolveFromJsRuntime(homeDir: string) {
  const jsRuntimeRoot = path.join(homeDir, ".vite-plus", "js_runtime", "node")
  const versions = fs.readdirSync(jsRuntimeRoot).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  )

  for (const version of versions.reverse()) {
    const sdkDir = path.join(
      jsRuntimeRoot,
      version,
      "lib",
      "node_modules",
      "@mariozechner",
      "pi-coding-agent"
    )
    if (fs.existsSync(path.join(sdkDir, "dist", "index.js"))) {
      return sdkDir
    }
  }

  return undefined
}

export function tryResolvePiSdkDir() {
  if (process.env.PI_REMOTE_PI_SDK_DIR) {
    return process.env.PI_REMOTE_PI_SDK_DIR
  }

  const fromPathEnvironment = resolveFromPathEnvironment()
  if (fromPathEnvironment) {
    return fromPathEnvironment
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE
  if (!homeDir) {
    return undefined
  }

  try {
    return resolveFromJsRuntime(homeDir)
  } catch {
    return undefined
  }
}

export function resolvePiSdkDir() {
  const sdkDir = tryResolvePiSdkDir()
  if (sdkDir) {
    return sdkDir
  }

  throw new Error(
    "Could not locate the installed pi SDK package. Set PI_REMOTE_PI_SDK_DIR."
  )
}
