// Bundles the Pico server into dist/pico-server.mjs, and its pty-host into
// dist/pty-host.mjs.
//
// Direct dependencies stay external and load from node_modules at run time.
// pi-web-access ships TypeScript sources only for its host-neutral core, so it
// and its own dependencies are bundled in.
import { spawn, spawnSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const bundled = new Set(["pi-web-access"])
const external = Object.keys(pkg.dependencies).filter(
  (name) => !bundled.has(name)
)

const options = {
  absWorkingDir: root,
  // The pty-host is a second program: it owns the terminals, so they
  // survive a server restart (see src/pty-host/main.ts).
  entryPoints: {
    "pico-server": "src/main.ts",
    "pty-host": "src/pty-host/main.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
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
  const serverFile = join(root, "dist/pico-server.mjs")
  /** The working directory of a process, or "" when it is not known. */
  const processCwd = (pid) => {
    try {
      if (process.platform === "linux") return realpathSync(`/proc/${pid}/cwd`)
      const result = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
        encoding: "utf8",
      })
      const line = result.stdout
        .split("\n")
        .find((item) => item.startsWith("n"))
      return line ? realpathSync(line.slice(1)) : ""
    } catch {
      return ""
    }
  }
  /** Whether a Pico process runs this checkout's server build. */
  const runsThisBuild = (pid, command) =>
    command.includes(serverFile) ||
    (/(^|\s)(\.\/)?dist\/pico-server\.mjs(\s|$)/.test(command) &&
      processCwd(pid) === realpathSync(root))
  /**
   * Another Pico already serves the data directory, so the new server did
   * not start. When that Pico runs this checkout's build, ask it to restart
   * (it waits for active turns), so it loads the new build. Else say that
   * changes do not load.
   */
  const restartRunning = async (pid, url) => {
    const command =
      process.platform === "win32"
        ? ""
        : spawnSync("ps", ["-o", "command=", "-p", pid], {
            encoding: "utf8",
          }).stdout.trim()
    if (!runsThisBuild(pid, command)) {
      console.warn(
        `[dev] Another Pico (pid ${pid}) runs at ${url} with other code${command ? `: ${command}` : ""}. Server changes do not load. Stop it (pico-app stop), then start pnpm dev again.`
      )
      return
    }
    try {
      const response = await fetch(`${url}/api/system/restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      console.log(
        `[dev] Pico (pid ${pid}) at ${url} restarts with the new build when its active turns end.`
      )
    } catch (error) {
      console.warn(
        `[dev] Could not restart Pico (pid ${pid}) at ${url}: ${error instanceof Error ? error.message : String(error)}. Run pico-app restart.`
      )
    }
  }
  let child
  let restarting = Promise.resolve()
  const restart = () => {
    restarting = restarting.then(async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise((done) => child.once("exit", done))
        child.kill("SIGTERM")
        await stopped
      }
      child = spawn(
        process.execPath,
        ["--enable-source-maps", "dist/pico-server.mjs", ...serverArgs],
        {
          cwd: root,
          stdio: ["inherit", "pipe", "inherit"],
          env: { ...process.env, PICO_SUPERVISED: "1" },
        }
      )
      // The first output tells when another Pico already runs.
      let output = ""
      let scanning = true
      child.stdout.on("data", (chunk) => {
        process.stdout.write(chunk)
        if (!scanning) return
        output += chunk.toString()
        const running =
          /Pico is already running \(pid (\d+)\) at (http:\/\/\S+)/.exec(output)
        if (running) void restartRunning(running[1], running[2])
        if (running || output.length > 4096) scanning = false
      })
      // The server asked for a restart (RESTART_EXIT_CODE in src/main.ts).
      child.once("exit", (code) => {
        if (code === 75) void restart()
      })
    })
    return restarting
  }
  const context = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "restart",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) return restart()
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
