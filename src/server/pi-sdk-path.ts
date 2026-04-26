import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PI_CODING_AGENT_PACKAGE = "@mariozechner/pi-coding-agent"

function normalizeSdkDir(candidate: string | undefined) {
  if (!candidate) return undefined

  try {
    const sdkDir = candidate.startsWith("file:")
      ? fileURLToPath(candidate)
      : candidate
    return fs.existsSync(path.join(sdkDir, "dist", "index.js"))
      ? sdkDir
      : undefined
  } catch {
    return undefined
  }
}

function findNodeModulePackageDir(startDir: string | undefined) {
  if (!startDir) return undefined

  let current = path.resolve(startDir)
  while (true) {
    const candidate = normalizeSdkDir(
      path.join(current, "node_modules", "@mariozechner", "pi-coding-agent")
    )
    if (candidate) return candidate

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function resolveFromBundledDependency() {
  try {
    const entryUrl = (
      import.meta as ImportMeta & {
        resolve?: (specifier: string) => string
      }
    ).resolve?.(PI_CODING_AGENT_PACKAGE)
    if (entryUrl) {
      const entry = entryUrl.startsWith("file:")
        ? fileURLToPath(entryUrl)
        : entryUrl
      const sdkDir = normalizeSdkDir(path.dirname(path.dirname(entry)))
      if (sdkDir) return sdkDir
    }
  } catch {
    // Fall back to walking node_modules below. Some runners do not expose
    // import.meta.resolve even though Node can run the resolved dependency.
  }

  const sourceDir = (() => {
    try {
      return path.dirname(fileURLToPath(import.meta.url))
    } catch {
      return undefined
    }
  })()

  return (
    findNodeModulePackageDir(sourceDir) ??
    findNodeModulePackageDir(process.cwd()) ??
    findNodeModulePackageDir(process.env.INIT_CWD)
  )
}

export function tryResolvePiSdkDir() {
  const explicitSdkDir = normalizeSdkDir(process.env.PI_REMOTE_PI_SDK_DIR)
  if (explicitSdkDir) {
    return explicitSdkDir
  }

  const fromBundledDependency = resolveFromBundledDependency()
  if (fromBundledDependency) {
    return fromBundledDependency
  }

  return undefined
}

export function resolvePiSdkDir() {
  const sdkDir = tryResolvePiSdkDir()
  if (sdkDir) {
    return sdkDir
  }

  throw new Error(
    "Could not locate the bundled SDK package. Run pnpm install or set PI_REMOTE_PI_SDK_DIR."
  )
}
