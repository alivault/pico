#!/usr/bin/env node
/**
 * Make the Smith icons from the mark: `pnpm icons` (from the repo root or
 * apps/smith).
 *
 * Writes into apps/smith/public and apps/website/site:
 * - favicon.svg: the mark in a square, black, and white in dark mode
 *   (prefers-color-scheme), so the tab icon follows the system theme.
 * - favicon-light.svg (black) and favicon-dark.svg (white): the icons that
 *   the pages link, each with media="(prefers-color-scheme: …)".
 * - favicon.png (32 px) and favicon.ico: fallbacks, black on white.
 * - apple-touch-icon.png (180 px): black on white.
 * - icon-192.png, icon-512.png: PWA icons, black on white.
 * - icon-maskable-512.png: the mark in the maskable safe zone.
 * - badge.png (96 px, app only): the mark on transparent, for the
 *   notification badge (only its alpha shows).
 *
 * Needs rsvg-convert (librsvg; `brew install librsvg`). The .ico needs
 * macOS `sips`; elsewhere it is skipped.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const website = resolve(app, "..", "website", "site")

/**
 * The mark, 20 × 11: two offset wedges. Keep it the same as
 * src/components/smith-mark.tsx and the nav of apps/website/site/index.html.
 */
const MARK_PATHS = [
  "M7.354.854A.5.5 0 0 1 7.707 0h11.086a.5.5 0 0 1 .353.854l-3 3a.5.5 0 0 0-.146.353v4.086a.5.5 0 0 1-.854.353zm5.292 9.292a.5.5 0 0 1-.353.854H1.207a.5.5 0 0 1-.353-.854l3-3A.5.5 0 0 0 4 6.793V2.707a.5.5 0 0 1 .854-.353z",
]
const MARK_WIDTH = 20
const MARK_HEIGHT = 11

/**
 * The mark centered in a square. `scale` is the square's side over the
 * mark's width, so a larger scale gives more padding.
 */
function squareSvg({ scale, fill, background, style = "" }) {
  const size = Number((MARK_WIDTH * scale).toFixed(3))
  const x = Number(((MARK_WIDTH - size) / 2).toFixed(3))
  const y = Number(((MARK_HEIGHT - size) / 2).toFixed(3))
  const rect = background
    ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${background}"/>`
    : ""
  const paths = MARK_PATHS.map(
    (d) =>
      `<path fill-rule="evenodd" clip-rule="evenodd" d="${d}" fill="${fill}"/>`
  ).join("\n")
  return `<svg width="32" height="32" viewBox="${x} ${y} ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
${style}${rect}
${paths}
</svg>
`
}

const favicon = squareSvg({
  scale: 32 / 28,
  fill: "#000",
  style:
    "<style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style>\n",
})
// One color each. The pages link both, with media="(prefers-color-scheme: …)":
// the browser checks a link's media also when the scheme changes, but reads
// the media query inside an SVG only when it loads the file.
const faviconLight = squareSvg({ scale: 32 / 28, fill: "#000" })
const faviconDark = squareSvg({ scale: 32 / 28, fill: "#fff" })
for (const dir of [join(app, "public"), website]) {
  writeFileSync(join(dir, "favicon.svg"), favicon)
  writeFileSync(join(dir, "favicon-light.svg"), faviconLight)
  writeFileSync(join(dir, "favicon-dark.svg"), faviconDark)
}

const work = mkdtempSync(join(tmpdir(), "smith-icons-"))
function png(name, svg, pixels, dirs) {
  const source = join(work, `${name}.svg`)
  writeFileSync(source, svg)
  for (const dir of dirs)
    execFileSync("rsvg-convert", [
      "-w",
      String(pixels),
      "-h",
      String(pixels),
      source,
      "-o",
      join(dir, name),
    ])
}

const both = [join(app, "public"), website]
// Small icons need less padding to stay legible.
png(
  "favicon.png",
  squareSvg({ scale: 32 / 28, fill: "#000", background: "#fff" }),
  32,
  both
)
png(
  "apple-touch-icon.png",
  squareSvg({ scale: 44 / 28, fill: "#000", background: "#fff" }),
  180,
  both
)
png(
  "icon-192.png",
  squareSvg({ scale: 44 / 28, fill: "#000", background: "#fff" }),
  192,
  [join(app, "public")]
)
png(
  "icon-512.png",
  squareSvg({ scale: 44 / 28, fill: "#000", background: "#fff" }),
  512,
  [join(app, "public")]
)
// The maskable safe zone is the inner circle of 80 % of the size: a mark
// half the width of the icon leaves room on all sides.
png(
  "icon-maskable-512.png",
  squareSvg({ scale: 56 / 28, fill: "#000", background: "#fff" }),
  512,
  [join(app, "public")]
)
png("badge.png", squareSvg({ scale: 32 / 28, fill: "#000" }), 96, [
  join(app, "public"),
])

if (process.platform === "darwin")
  for (const dir of both)
    execFileSync(
      "sips",
      [
        "-s",
        "format",
        "ico",
        join(dir, "favicon.png"),
        "--out",
        join(dir, "favicon.ico"),
      ],
      { stdio: "ignore" }
    )
else console.warn("Skipped favicon.ico: it needs macOS sips.")

console.log(`Wrote the icons into ${join(app, "public")} and ${website}.`)
