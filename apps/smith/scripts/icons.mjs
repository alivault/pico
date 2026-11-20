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

/** The mark, 28 × 16. Keep it the same as src/components/smith-mark.tsx. */
const MARK_PATHS = [
  "M9.53076 0.0599273C9.43151 0.0579884 9.33397 0.0859342 9.25081 0.140136C9.16765 0.194338 9.1027 0.272292 9.06441 0.363875C9.02611 0.455458 9.01624 0.55644 9.03607 0.653706C9.05589 0.750973 9.10451 0.840031 9.1756 0.909316L21.2625 13.2445C21.3361 13.3194 21.4315 13.3693 21.535 13.387C21.6386 13.4047 21.7451 13.3894 21.8394 13.3431C21.9337 13.2969 22.0111 13.2221 22.0605 13.1294C22.1099 13.0367 22.1289 12.9308 22.1147 12.8267L21.2519 6.56131C21.2028 6.20743 21.2495 5.84687 21.387 5.51712C21.5244 5.18737 21.7477 4.90046 22.0336 4.68622L27.1018 0.900038C27.1858 0.837017 27.2479 0.749124 27.2791 0.648834C27.3104 0.548544 27.3093 0.440951 27.276 0.341329C27.2426 0.241707 27.1788 0.155116 27.0934 0.0938463C27.0081 0.0325767 26.9056 -0.000258263 26.8006 1.5298e-06L9.53076 0.0599273Z",
  "M17.771 15.514C17.8703 15.516 17.9678 15.488 18.051 15.4338C18.1342 15.3796 18.1991 15.3017 18.2374 15.2101C18.2757 15.1185 18.2856 15.0175 18.2657 14.9202C18.2459 14.823 18.1973 14.7339 18.1262 14.6646L6.03927 2.32948C5.96567 2.25452 5.87033 2.20465 5.76678 2.18694C5.66323 2.16923 5.55674 2.18458 5.46241 2.23082C5.36808 2.27706 5.29071 2.35184 5.24129 2.44454C5.19186 2.53724 5.17289 2.64315 5.18706 2.74724L6.04992 9.01264C6.09897 9.36652 6.05233 9.72708 5.91485 10.0568C5.77737 10.3866 5.55408 10.6735 5.26818 10.8877L0.20005 14.6739C0.116 14.7369 0.0539359 14.8248 0.0226654 14.9251C-0.00860518 15.0254 -0.00749338 15.133 0.025844 15.2326C0.0591814 15.3322 0.123049 15.4188 0.208384 15.4801C0.293719 15.5414 0.396185 15.5742 0.501237 15.5739L17.771 15.514Z",
]
const MARK_WIDTH = 28
const MARK_HEIGHT = 16

/**
 * The mark centered in a square of `size` view units, `size` wide. The mark
 * is 28 units wide, so a larger size gives more padding.
 */
function squareSvg({ size, fill, background, style = "" }) {
  const x = (MARK_WIDTH - size) / 2
  const y = (MARK_HEIGHT - size) / 2
  const rect = background
    ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${background}"/>`
    : ""
  const paths = MARK_PATHS.map((d) => `<path d="${d}" fill="${fill}"/>`).join(
    "\n"
  )
  return `<svg width="${size}" height="${size}" viewBox="${x} ${y} ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
${style}${rect}
${paths}
</svg>
`
}

const favicon = squareSvg({
  size: 32,
  fill: "#000",
  style:
    "<style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style>\n",
})
// One color each. The pages link both, with media="(prefers-color-scheme: …)":
// the browser checks a link's media also when the scheme changes, but reads
// the media query inside an SVG only when it loads the file.
const faviconLight = squareSvg({ size: 32, fill: "#000" })
const faviconDark = squareSvg({ size: 32, fill: "#fff" })
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
  squareSvg({ size: 32, fill: "#000", background: "#fff" }),
  32,
  both
)
png(
  "apple-touch-icon.png",
  squareSvg({ size: 44, fill: "#000", background: "#fff" }),
  180,
  both
)
png(
  "icon-192.png",
  squareSvg({ size: 44, fill: "#000", background: "#fff" }),
  192,
  [join(app, "public")]
)
png(
  "icon-512.png",
  squareSvg({ size: 44, fill: "#000", background: "#fff" }),
  512,
  [join(app, "public")]
)
// The maskable safe zone is the inner circle of 80 % of the size: a 28-unit
// mark in 56 units leaves room on all sides.
png(
  "icon-maskable-512.png",
  squareSvg({ size: 56, fill: "#000", background: "#fff" }),
  512,
  [join(app, "public")]
)
png("badge.png", squareSvg({ size: 32, fill: "#000" }), 96, [
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
