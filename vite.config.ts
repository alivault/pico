import { defineConfig } from "vite-plus"
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
    fs: {
      allow: fsAllow,
    },
  },
  plugins: [
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({
      presets: [reactCompilerPreset()],
    }),
  ],
})

export default config
