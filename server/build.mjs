// Bundles the Pico server into dist/pico-server.mjs.
//
// Direct dependencies stay external and load from node_modules at run time.
// pi-web-access ships TypeScript sources only for its host-neutral core, so it
// and its own dependencies are bundled in.
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const bundled = new Set(["pi-web-access"])
const external = Object.keys(pkg.dependencies).filter((name) => !bundled.has(name))

const options = {
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  outfile: "dist/pico-server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  logLevel: "warning",
  external: [...external, ...external.map((name) => `${name}/*`)],
  define: { PICO_VERSION: JSON.stringify(pkg.version) },
  banner: {
    js: [
      'import { createRequire as __picoCreateRequire } from "node:module";',
      "const require = __picoCreateRequire(import.meta.url);",
    ].join("\n"),
  },
}

const watch = process.argv.includes("--watch")
if (!watch) {
  await esbuild.build(options)
} else {
  // Rebuild on change and restart the server with the arguments after "--".
  const serverArgs = process.argv.includes("--")
    ? process.argv.slice(process.argv.indexOf("--") + 1)
    : ["serve"]
  let child
  const restart = () => {
    if (child) child.kill("SIGTERM")
    child = spawn(process.execPath, ["--enable-source-maps", "dist/pico-server.mjs", ...serverArgs], {
      cwd: root,
      stdio: "inherit",
    })
  }
  const context = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "restart",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) restart()
          })
        },
      },
    ],
  })
  await context.watch()
  const stop = () => {
    child?.kill("SIGTERM")
    void context.dispose().then(() => process.exit(0))
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}
