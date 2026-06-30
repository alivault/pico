import os from "node:os"

import { defineConfig } from "vite-plus"
import type { Plugin } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"
import { searchForWorkspaceRoot } from "vite"

import { tryResolvePiSdkDir } from "./src/server/pi-sdk-path.ts"

const piSdkDir = tryResolvePiSdkDir()
const fsAllow = [searchForWorkspaceRoot(process.cwd())]
if (piSdkDir) {
  fsAllow.push(piSdkDir)
}

const localHostname = os.hostname()
const localHostnameWithoutSuffix = localHostname.replace(/\.local$/i, "")
const allowedHosts = Array.from(
  new Set([
    // Tailscale MagicDNS names are outside Vite's default localhost/IP allowlist.
    // Keep this scoped to Tailscale instead of disabling host checks entirely.
    ".ts.net",
    localHostname,
    localHostname.toLowerCase(),
    localHostnameWithoutSuffix,
    localHostnameWithoutSuffix.toLowerCase(),
    `${localHostnameWithoutSuffix}.local`,
    `${localHostnameWithoutSuffix.toLowerCase()}.local`,
  ])
)

function devAssetFetchMetadataFallback(): Plugin {
  return {
    name: "pico-dev-asset-fetch-metadata-fallback",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const acceptValues = request.headers.accept
          ?.split(",")
          .map((value) => value.trim())
        const url = new URL(request.url ?? "/", "http://pico.local")
        const path = url.pathname
        const hasFetchDest = Boolean(request.headers["sec-fetch-dest"])
        const acceptsCss = acceptValues?.some((value) =>
          value.startsWith("text/css")
        )
        const isCssModuleRequest =
          path.endsWith(".css") &&
          (url.searchParams.has("url") ||
            url.searchParams.has("raw") ||
            url.searchParams.has("inline"))

        if (path.endsWith(".css") && acceptsCss && !isCssModuleRequest) {
          // Some browsers/clients do not send Fetch Metadata headers over
          // non-local HTTP origins. TanStack Start's dev asset handling relies
          // on this header to avoid routing dev assets as app pages.
          request.headers["sec-fetch-dest"] ??= "style"

          if (path.startsWith("/src/") && !hasFetchDest) {
            const result = await server.transformRequest(`${path}?direct`)
            if (result) {
              response.setHeader("Content-Type", "text/css")
              response.setHeader("Cache-Control", "no-cache")
              response.end(result.code)
              return
            }
          }
        } else if (path && !hasFetchDest) {
          if (isCssModuleRequest || /\.(?:js|mjs|ts|tsx|jsx)$/.test(path)) {
            request.headers["sec-fetch-dest"] = "script"
          } else if (/\.(?:woff2?|ttf|otf|eot)$/.test(path)) {
            request.headers["sec-fetch-dest"] = "font"
          }
        }
        next()
      })
    },
  }
}

const config = defineConfig({
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts"],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    endOfLine: "lf",
    semi: false,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "es5",
    printWidth: 80,
    sortTailwindcss: {
      stylesheet: "src/styles.css",
      functions: ["cn", "cva"],
    },
    sortPackageJson: false,
    ignorePatterns: [
      "package-lock.json",
      "pnpm-lock.yaml",
      "src/routeTree.gen.ts",
      "yarn.lock",
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3141,
    allowedHosts,
    fs: {
      allow: fsAllow,
    },
  },
  preview: {
    port: 3141,
    allowedHosts,
  },
  plugins: [
    devtools(),
    nitro({
      features: { websocket: true },
      scanDirs: ["src/nitro"],
      traceDeps: ["node-pty*"],
    }),
    tailwindcss(),
    devAssetFetchMetadataFallback(),
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})

export default config
