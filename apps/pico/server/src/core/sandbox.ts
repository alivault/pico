/**
 * The bash sandbox of profiles with `bash: "sandbox"` (`read-only` and
 * `reviewer`): each bash call runs in bubblewrap (`bwrap`, Linux only).
 *
 * - The filesystem is read-only. The agent's repository (or its working
 *   directory) and the user's caches get a temporary overlay: a command can
 *   write there, for example a test build, but the changes are gone when the
 *   call ends. `/tmp` is a new, empty tmpfs; a working directory in it is
 *   mounted again on top. bwrap reads overlay sources from the host, so an
 *   overlay in /tmp works too.
 * - There is no network. This also blocks Pico's own API on localhost, which
 *   has no login and could start an agent without the sandbox.
 * - `/run/user/<uid>` is hidden, so the command cannot reach the user's
 *   systemd, D-Bus, the pty-host, or the ssh-agent, and start a process
 *   outside the sandbox.
 * - The command gets its own PID namespace and a new session, and it stops
 *   when the tool call stops.
 *
 * Overlayfs cannot go on a directory that has another mount inside it (for
 * example a FUSE mount in the home directory). Such a directory stays
 * read-only. Without bubblewrap, a sandboxed profile cannot use bash at all.
 */
import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** The environment variable that carries the script into the sandbox. */
export const SANDBOX_SCRIPT_ENV = "PICO_SANDBOX_SCRIPT"

/** Caches that commands such as test runners and package managers write. */
const CACHE_DIRS = [".cache", ".local/state", ".npm"]

let available: Promise<boolean> | undefined

/** Whether bubblewrap runs here, with the namespaces the sandbox needs. */
export function sandboxAvailable() {
  available ??= (async () => {
    if (process.platform !== "linux") return false
    try {
      await run(
        "bwrap",
        ["--ro-bind", "/", "/", "--unshare-all", "--", "/bin/true"],
        { timeout: 10_000 }
      )
      return true
    } catch {
      return false
    }
  })()
  return available
}

/** The mount points in `/proc/self/mountinfo`. */
function mountPoints() {
  try {
    return readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      .map((line) => line.split(" ")[4])
      .filter((point): point is string => Boolean(point))
      .map((point) =>
        point.replace(/\\([0-7]{3})/g, (_, code: string) =>
          String.fromCharCode(Number.parseInt(code, 8))
        )
      )
  } catch {
    return []
  }
}

/** The directories that get a temporary overlay, in mount order. */
export function overlayDirs(
  workDir: string,
  options: { home?: string; mounts?: readonly string[] } = {}
) {
  const home = resolve(options.home ?? homedir())
  const mounts = options.mounts ?? mountPoints()
  const hasMountInside = (dir: string) =>
    mounts.some((point) => point.startsWith(`${dir}/`))
  const candidates = [
    resolve(workDir),
    ...CACHE_DIRS.map((dir) => join(home, dir)),
  ]
  const dirs: string[] = []
  for (const dir of candidates) {
    if (dir === "/" || dir === home || dirs.includes(dir)) continue
    // A directory inside one that already has an overlay is covered.
    if (dirs.some((other) => dir.startsWith(`${other}/`))) continue
    if (!existsSync(dir) || hasMountInside(dir)) continue
    dirs.push(dir)
  }
  return dirs
}

/** Quote a word for a POSIX shell. */
function quote(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replace(/'/g, `'"'"'`)}'`
}

/** The bwrap arguments for a command in `cwd`, which overlays `overlays`. */
export function sandboxArgs(
  cwd: string,
  overlays: readonly string[],
  uid = process.getuid?.() ?? 0
) {
  const args = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ]
  const runtimeDir = `/run/user/${uid}`
  if (existsSync(runtimeDir)) args.push("--tmpfs", runtimeDir)
  for (const dir of overlays)
    args.push("--overlay-src", dir, "--tmp-overlay", dir)
  // A working directory in /tmp is under the new tmpfs: show it again,
  // read-only, when no overlay covers it.
  const covered = overlays.some(
    (dir) => cwd === dir || cwd.startsWith(`${dir}/`)
  )
  if ((cwd === "/tmp" || cwd.startsWith("/tmp/")) && !covered)
    args.push("--ro-bind", cwd, cwd)
  args.push(
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--chdir",
    cwd
  )
  return args
}

/** The git repository root of `cwd`, or `cwd`. */
async function workDirOf(cwd: string) {
  try {
    const { stdout } = await run(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { timeout: 5000 }
    )
    return stdout.trim() || cwd
  } catch {
    return cwd
  }
}

/**
 * Change a bash execution to run `script` in the sandbox. The script goes in
 * an environment variable, so it needs no quoting.
 */
export async function sandboxExecution(execution: {
  command: string
  cwd: string
  env: Record<string, string>
}) {
  const overlays = overlayDirs(await workDirOf(execution.cwd))
  execution.env[SANDBOX_SCRIPT_ENV] = execution.command
  execution.command = [
    "exec bwrap",
    ...sandboxArgs(execution.cwd, overlays).map(quote),
    `-- bash -c "$${SANDBOX_SCRIPT_ENV}"`,
  ].join(" ")
}
