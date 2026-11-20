#!/usr/bin/env node
/**
 * Make the Open Graph image of the website (the preview in links on
 * social sites and chat apps): apps/website/site/og.png, 1200×630 at 2×.
 *
 *   pnpm og-image
 *
 * It uses the dark desktop screenshot of the website, so run it again after
 * `pnpm media --install`. Chromium draws the page below.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const siteDir = resolve(appDir, "../website/site")
const require = createRequire(join(appDir, "server/package.json"))
const { chromium } = require("playwright-core")

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    const found = spawnSync("sh", ["-c", `command -v ${name}`], {
      encoding: "utf8",
    })
    if (found.status === 0) return found.stdout.trim()
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}

const dataUrl = (file, type) =>
  `data:${type};base64,${readFileSync(join(siteDir, file)).toString("base64")}`

const html = `<!doctype html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    position: relative;
    background:
      radial-gradient(900px 500px at 85% 110%, rgba(10, 132, 255, 0.22), transparent 70%),
      radial-gradient(700px 400px at 0% 0%, rgba(255, 255, 255, 0.06), transparent 70%),
      #0a0a0a;
    color: #f5f5f5;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .text {
    position: absolute;
    left: 72px;
    top: 72px;
    width: 470px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .brand img {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
  }
  h1 {
    margin-top: 56px;
    font-size: 52px;
    line-height: 1.08;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  p {
    margin-top: 24px;
    font-size: 22px;
    line-height: 1.45;
    color: #a3a3a3;
  }
  .url {
    position: absolute;
    left: 72px;
    bottom: 60px;
    font-size: 20px;
    color: #a3a3a3;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .shot {
    position: absolute;
    left: 600px;
    top: 84px;
    width: 1000px;
    border-radius: 14px;
    border: 1px solid #2e2e2e;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }
  .shot img { display: block; width: 100%; }
</style>
</head>
<body>
  <div class="text">
    <div class="brand"><img src="${dataUrl("favicon.svg", "image/svg+xml")}" alt="">Smith</div>
    <h1>A web workspace for your Pi coding agents.</h1>
    <p>Durable agents, subagents in Git worktrees, and terminals, on your own machine.</p>
  </div>
  <div class="url">smith.aliabbas.net</div>
  <div class="shot"><img src="${dataUrl("screenshots/smith-workspace.png", "image/png")}" alt=""></div>
</body>
</html>`

const browser = await chromium.launch({ executablePath: findChromium() })
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  })
  await page.setContent(html, { waitUntil: "load" })
  const target = join(siteDir, "og.png")
  await page.screenshot({ path: target })
  console.log(`Wrote ${target}`)
} finally {
  await browser.close()
}
