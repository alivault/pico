#!/usr/bin/env node
/**
 * Take the screenshots and the demo video of the website and the README.
 *
 *   pnpm media                  # video and screenshots, into the output folder
 *   pnpm media --install        # and copy them into the website and the README
 *   pnpm media --screenshots    # only the screenshots (the agent still runs)
 *   pnpm media --video          # only the video
 *   pnpm media --no-build       # use the built web and server as they are
 *   pnpm media --out DIR        # the output folder (default: <tmp>/pico-demo/out)
 *   pnpm media --install-only   # copy the files of the last run; take nothing
 *   pnpm media --dry            # only open the new agent page (dry.png); no model
 *
 * It makes the demo project (`demo-project.mjs`) and starts its own Pico,
 * with its own data folder and port, so your Pico and its agents are not
 * touched. A real model does the work: Pico uses your Pi credentials and
 * default model, so a run costs one agent task with two subagents, a few
 * minutes. It gets an agent folder of its own, with a link to your
 * `auth.json` and only the model lines of your `settings.json`, so your
 * AGENTS.md, skills, and extensions do not change what the agent does.
 * Chromium draws the pages, and ffmpeg makes the video.
 *
 * The output folder gets:
 *   pico-workspace.png       desktop, dark (2898×1916)
 *   pico-workspace-alt.png   desktop, light
 *   pico-mobile.png          phone, dark (1170×2532)
 *   pico-mobile-alt.png      phone, light
 *   pico-child-sessions-demo.mp4 and .webp (the poster)
 *   review.png               frames of the video, to look at it fast
 *
 * To change the story, change PROMPT and the steps in `recordRun`. To
 * change what a screenshot shows, change `desktopShot` or `mobileShot`.
 */
import { spawn, spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createDemoProject } from "./demo-project.mjs"

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const repoDir = resolve(appDir, "../..")
const require = createRequire(join(appDir, "server/package.json"))
const { chromium } = require("playwright-core")

const PROMPT =
  "`tasks list --overdue` shows nothing, but I have overdue tasks. Start two subagents, each in its own worktree: one finds and fixes that bug with a test, the other adds a `tasks remove <id>` command with a test. When both are done, merge their branches and run all the tests."

const DESKTOP = { viewport: { width: 1449, height: 958 }, deviceScaleFactor: 2 }
const VIDEO = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

/** Where `--install` copies each file. */
const INSTALL = {
  "pico-workspace.png": [
    "apps/website/site/screenshots",
    "apps/pico/public/screenshots",
  ],
  "pico-workspace-alt.png": [
    "apps/website/site/screenshots",
    "apps/pico/public/screenshots",
  ],
  "pico-mobile.png": [
    "apps/website/site/screenshots",
    "apps/pico/public/screenshots",
  ],
  "pico-mobile-alt.png": [
    "apps/website/site/screenshots",
    "apps/pico/public/screenshots",
  ],
  "pico-child-sessions-demo.mp4": ["apps/website/site/videos"],
  "pico-child-sessions-demo.webp": ["apps/website/site/videos"],
}

function parseOptions(argv) {
  const has = (flag) => argv.includes(flag)
  const outIndex = argv.indexOf("--out")
  const onlyVideo = has("--video") && !has("--screenshots")
  const onlyShots = has("--screenshots") && !has("--video")
  return {
    video: !onlyShots,
    screenshots: !onlyVideo,
    install: has("--install") || has("--install-only"),
    installOnly: has("--install-only"),
    build: !has("--no-build"),
    dry: has("--dry"),
    out: resolve(
      outIndex >= 0 ? argv[outIndex + 1] : join(tmpdir(), "pico-demo", "out")
    ),
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`)
}

function need(command) {
  if (spawnSync("sh", ["-c", `command -v ${command}`]).status !== 0)
    throw new Error(`${command} is missing. Install it and try again.`)
}

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    const found = spawnSync("sh", ["-c", `command -v ${name}`], {
      encoding: "utf8",
    })
    if (found.status === 0) return found.stdout.trim()
  }
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  return mac
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * A Pi agent folder for the demo: your credentials (a link, so a token
 * refresh reaches your own file) and your default model, nothing more.
 */
function demoAgentDir(dir) {
  const source = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const name of ["auth.json", "models.json"])
    if (existsSync(join(source, name)))
      symlinkSync(join(source, name), join(dir, name))
  const settings = existsSync(join(source, "settings.json"))
    ? JSON.parse(readFileSync(join(source, "settings.json"), "utf8"))
    : {}
  const keep = ["defaultProvider", "defaultModel", "defaultThinkingLevel"]
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify(
      Object.fromEntries(
        keep.flatMap((key) => (key in settings ? [[key, settings[key]]] : []))
      ),
      null,
      2
    )
  )
  return dir
}

/** Start a Pico of its own; returns its URL and a stop function. */
async function startPico(dataDir, agentDir) {
  const port = await freePort()
  const child = spawn(
    process.execPath,
    [
      join(appDir, "bin/pico.mjs"),
      "serve",
      "--port",
      String(port),
      "--data-dir",
      dataDir,
      "--no-open",
      "--no-pty-host",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    }
  )
  let log = ""
  child.stdout.on("data", (chunk) => (log += chunk))
  child.stderr.on("data", (chunk) => (log += chunk))
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Pico stopped:\n${log}`)
    const ok = await fetch(`${url}/api/system/health`)
      .then((response) => response.ok)
      .catch(() => false)
    if (ok) break
    await sleep(500)
  }
  return {
    url,
    async stop() {
      child.kill("SIGTERM")
      await new Promise((done) => child.once("exit", done))
    },
  }
}

/** True while the agent of the page works, or a sidebar agent works. */
function busy(page) {
  return page.evaluate(
    () =>
      Boolean(document.querySelector('button[aria-label="Abort"]')) ||
      [...document.querySelectorAll("[data-slot=sidebar] .animate-spin")].some(
        (element) => element.getClientRects().length > 0
      )
  )
}

/** The ID of the first agent of the demo Pico; waits until it exists. */
async function firstAgent(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { agents } = await fetch(`${url}/api/machine/agents`).then((r) =>
      r.json()
    )
    if (agents?.length) return agents.at(-1).id
    await sleep(500)
  }
  throw new Error("The agent did not start.")
}

/** Open the Agent tab of the right sidebar (desktop). */
async function openAgentTab(page) {
  const tab = page.locator("button[aria-pressed]:visible", {
    hasText: /^Agent/,
  })
  if (!(await tab.count())) {
    await page.click('button[aria-label="Toggle right sidebar"]')
    await page.waitForTimeout(800)
  }
  await tab.first().click()
}

/**
 * Run the demo in a browser: type the prompt, show the subagents, open one,
 * and wait until all work ends. With `framesDir`, record the page.
 */
async function recordRun(browser, url, project, framesDir, dryShot, errorShot) {
  const context = await browser.newContext({ ...VIDEO, colorScheme: "dark" })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForSelector("textarea")
  // A new agent in the demo project (the button shows on hover).
  const create = page.locator(
    `button[aria-label="Create an agent in ${project}"]`
  )
  await create.first().click({ force: true })
  await page.mouse.move(900, 300)
  await page.waitForTimeout(2000)
  if (dryShot) {
    await page.screenshot({ path: dryShot })
    await context.close()
    return undefined
  }

  const t0 = Date.now() / 1000
  const marks = {}
  const mark = (name) => {
    marks[name] = Date.now() / 1000 - t0
    console.log(`  ${name} at ${marks[name].toFixed(1)} s`)
  }
  const frames = []
  let cdp
  let tick
  if (framesDir) {
    mkdirSync(framesDir, { recursive: true })
    cdp = await context.newCDPSession(page)
    cdp.on("Page.screencastFrame", async (frame) => {
      const name = join(
        framesDir,
        `f${String(frames.length).padStart(5, "0")}.jpg`
      )
      writeFileSync(name, Buffer.from(frame.data, "base64"))
      frames.push({ name, t: frame.metadata.timestamp - t0 })
      await cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {})
    })
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: 2880,
      maxHeight: 1800,
    })
    // A screencast sends frames only when the page changes; this keeps
    // them coming, so the video has no long gaps.
    tick = setInterval(() => {
      page
        .evaluate(() => (document.body.dataset.tick = String(Date.now())))
        .catch(() => {})
    }, 100)
  }
  try {
    await page.waitForTimeout(1500)
    await page.click("textarea")
    await page.keyboard.type(PROMPT, { delay: 25 })
    await page.waitForTimeout(700)
    await page.keyboard.press("Enter")
    mark("sent")
    const parentUrl = `${url}/?agent=${await firstAgent(url)}`
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].filter(
          (button) => button.textContent.trim() === "Open"
        ).length >= 2,
      null,
      { timeout: 300_000 }
    )
    mark("spawned")
    await page.waitForTimeout(3000)
    await openAgentTab(page)
    mark("agent-tab")
    await page.waitForTimeout(5000)
    await page
      .getByRole("button", { name: "Open", exact: true })
      .first()
      .click()
    mark("child-open")
    await page.waitForTimeout(8000)
    await page.goBack()
    await page.waitForTimeout(1500)
    if (page.url() !== parentUrl) await page.goto(parentUrl)
    mark("parent-back")
    // Done: nothing worked for 6 s in a row.
    let idleSince
    const start = Date.now()
    while (Date.now() - start < 20 * 60_000) {
      await page.waitForTimeout(1000)
      if (await busy(page)) idleSince = undefined
      else if (idleSince === undefined) idleSince = Date.now()
      else if (Date.now() - idleSince > 6000) break
    }
    mark("done")
    const jump = page.locator(
      'button[aria-label="Jump to latest message"]:not([disabled])'
    )
    if (await jump.count()) await jump.first().click({ timeout: 2000 })
    await page.waitForTimeout(5000)
    mark("end")
    return { agentUrl: parentUrl, frames, marks }
  } catch (error) {
    if (errorShot) await page.screenshot({ path: errorShot }).catch(() => {})
    throw error
  } finally {
    if (cdp) await cdp.send("Page.stopScreencast").catch(() => {})
    if (tick) clearInterval(tick)
    await context.close()
  }
}

/**
 * Make the video from the frames. The parent's planning plays at 2× and
 * the wait for the subagents at 4×. Returns the poster time.
 */
function encodeVideo(frames, marks, out) {
  const speed = (t) => {
    if (marks.sent + 1 < t && t < marks.spawned) return 2
    if (marks["parent-back"] + 1 < t && t < marks.done - 1) return 4
    return 1
  }
  let time = 0
  let poster = 0
  const lines = []
  for (const [index, frame] of frames.entries()) {
    const next = frames[index + 1]
    const duration = next
      ? Math.max(next.t - frame.t, 0.001) / speed(frame.t)
      : 1.5
    if (!poster && frame.t >= marks["agent-tab"] + 3) poster = time
    lines.push(`file '${frame.name}'`, `duration ${duration.toFixed(4)}`)
    time += duration
  }
  lines.push(`file '${frames.at(-1).name}'`)
  const list = join(dirname(frames[0].name), "list.txt")
  writeFileSync(list, `${lines.join("\n")}\n`)
  const video = join(out, "pico-child-sessions-demo.mp4")
  run("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    "fps=30,scale=1920:-2:flags=lanczos:out_range=tv,format=yuv420p",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "slow",
    "-crf",
    "23",
    "-color_range",
    "tv",
    "-an",
    "-movflags",
    "+faststart",
    video,
  ])
  run("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(poster),
    "-i",
    video,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "80",
    join(out, "pico-child-sessions-demo.webp"),
  ])
  run("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    video,
    "-vf",
    "fps=1/4,scale=640:-1,tile=4x4",
    "-frames:v",
    "1",
    join(out, "review.png"),
  ])
  console.log(
    `  video: ${Math.round(time)} s, poster at ${poster.toFixed(1)} s`
  )
}

/** Open the folded tool calls of the turn ("Worked for 38s"). */
async function openWorkedFor(page) {
  const toggle = page.getByRole("button", { name: /^Worked for/ })
  if (await toggle.count()) await toggle.first().click()
  await page.waitForTimeout(800)
}

/** Scroll the conversation so the prompt is at the top. */
function scrollToPrompt(page) {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll("*"))
      if (
        element.scrollHeight > element.clientHeight + 50 &&
        getComputedStyle(element).overflowY !== "visible" &&
        element.textContent.includes("own worktree") &&
        element.getClientRects().length
      )
        element.scrollTop = 0
  })
}

/** Desktop: the conversation from the prompt, and the Agent tab. */
async function desktopShot(browser, agentUrl, scheme, path) {
  const context = await browser.newContext({ ...DESKTOP, colorScheme: scheme })
  const page = await context.newPage()
  await page.goto(agentUrl)
  await page.waitForTimeout(4000)
  await openAgentTab(page)
  await openWorkedFor(page)
  await scrollToPrompt(page)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1000)
  await page.screenshot({ path })
  await context.close()
}

/** Phone: the conversation at the subagent cards. */
async function mobileShot(browser, agentUrl, scheme, path) {
  const context = await browser.newContext({ ...MOBILE, colorScheme: scheme })
  const page = await context.newPage()
  await page.goto(agentUrl)
  await page.waitForTimeout(4000)
  await openWorkedFor(page)
  await page.evaluate(() => {
    const open = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent.trim() === "Open" && button.getClientRects().length
    )
    let scroller = open?.parentElement
    while (
      scroller &&
      !(
        scroller.scrollHeight > scroller.clientHeight + 50 &&
        getComputedStyle(scroller).overflowY !== "visible"
      )
    )
      scroller = scroller.parentElement
    if (open && scroller)
      scroller.scrollTop +=
        open.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        140
  })
  await page.waitForTimeout(1000)
  await page.screenshot({ path })
  await context.close()
}

/** Make a PNG smaller with a 256-color palette, as the website uses. */
function compressPng(source, target) {
  run("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vf",
    "split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none",
    target,
  ])
}

/** Copy the files into the website and the README screenshots. */
function install(out, names) {
  for (const name of names)
    for (const dir of INSTALL[name])
      copyFileSync(join(out, name), join(repoDir, dir, name))
  console.log("Copied them into the website and the README screenshots.")
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.installOnly) {
    install(options.out, Object.keys(INSTALL))
    return
  }
  need("ffmpeg")
  need("git")
  const root = join(tmpdir(), "pico-demo")
  const project = join(root, "tiny-tasks")
  const dataDir = join(root, "data")
  const raw = join(root, "raw")
  for (const dir of [dataDir, raw, join(root, "frames")])
    rmSync(dir, { recursive: true, force: true })
  mkdirSync(raw, { recursive: true })
  mkdirSync(options.out, { recursive: true })

  if (options.build) {
    console.log("Building the web and the server…")
    run("pnpm", ["build"], { cwd: appDir })
  }
  createDemoProject(project)
  console.log(`Demo project: ${project}`)
  const pico = await startPico(dataDir, demoAgentDir(join(root, "agent")))
  console.log(`Demo Pico: ${pico.url} (data in ${dataDir})`)
  const browser = await chromium.launch({ executablePath: findChromium() })
  try {
    // The sidebar shows the demo project.
    await fetch(`${pico.url}/api/sidebar-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projects: [project] }),
    })
    if (!options.dry)
      console.log("Running the demo (a real agent works; a few minutes)…")
    const result = await recordRun(
      browser,
      pico.url,
      project,
      options.video && !options.dry ? join(root, "frames") : undefined,
      options.dry ? join(options.out, "dry.png") : undefined,
      join(options.out, "error.png")
    )
    if (!result) {
      console.log(`Dry run: see ${join(options.out, "dry.png")}`)
      return
    }
    if (options.video) {
      console.log("Making the video…")
      encodeVideo(result.frames, result.marks, options.out)
    }
    if (options.screenshots) {
      console.log("Taking the screenshots…")
      const shots = [
        ["pico-workspace.png", desktopShot, "dark"],
        ["pico-workspace-alt.png", desktopShot, "light"],
        ["pico-mobile.png", mobileShot, "dark"],
        ["pico-mobile-alt.png", mobileShot, "light"],
      ]
      for (const [name, shot, scheme] of shots) {
        await shot(browser, result.agentUrl, scheme, join(raw, name))
        compressPng(join(raw, name), join(options.out, name))
      }
    }
  } finally {
    await browser.close()
    await pico.stop()
  }

  const made = Object.keys(INSTALL).filter((name) =>
    name.endsWith(".png") ? options.screenshots : options.video
  )
  console.log(`\nDone. Files in ${options.out}:`)
  for (const name of made) console.log(`  ${name}`)
  if (options.video) console.log("  review.png (frames of the video)")
  if (options.install) install(options.out, made)
  else console.log("To use them: pnpm media --install-only")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
