import { copyFileSync, existsSync } from "node:fs"
import os from "node:os"
import { join } from "node:path"

import { devtools } from "@tanstack/devtools-vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"
import { searchForWorkspaceRoot } from "vite"
import type { Plugin } from "vite"

const localHostname = os.hostname()
const localHostnameWithoutSuffix = localHostname.replace(/\.local$/i, "")
const allowedHosts = Array.from(
  new Set([
    ".ts.net",
    localHostname,
    localHostname.toLowerCase(),
    localHostnameWithoutSuffix,
    localHostnameWithoutSuffix.toLowerCase(),
    `${localHostnameWithoutSuffix}.local`,
    `${localHostnameWithoutSuffix.toLowerCase()}.local`,
  ])
)
const backendUrl = process.env.PICO_DEV_BACKEND_URL ?? "http://127.0.0.1:3142"
const backendProxy = {
  target: backendUrl,
  changeOrigin: true,
  ws: true,
}

function staticSpaShell(): Plugin {
  return {
    name: "pico-static-spa-shell",
    apply: "build",
    closeBundle() {
      const publicDirectory = join(process.cwd(), ".output", "public")
      const indexPath = join(publicDirectory, "index.html")
      if (!existsSync(indexPath)) {
        throw new Error("Vite did not produce the Pico SPA entry document")
      }
      copyFileSync(indexPath, join(publicDirectory, "_shell.html"))
    },
  }
}

const plugins = [
  devtools(),
  tailwindcss(),
  tanstackRouter({
    target: "react",
    autoCodeSplitting: true,
  }),
  viteReact(),
  babel({
    presets: [reactCompilerPreset()],
  }),
  staticSpaShell(),
] as unknown as Plugin[]

const config = {
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
  build: {
    outDir: ".output/public",
    emptyOutDir: true,
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 3141,
    strictPort: true,
    allowedHosts,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    proxy: {
      "/api": backendProxy,
      "/events": backendProxy,
    },
  },
  preview: {
    port: 3141,
    allowedHosts,
    proxy: {
      "/api": backendProxy,
      "/events": backendProxy,
    },
  },
  plugins,
}

export default config
