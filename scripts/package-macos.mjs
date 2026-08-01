#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const cargoVersion = /^version = "([^"]+)"$/m.exec(
  readFileSync(join(root, "crates/pico-server/Cargo.toml"), "utf8")
)?.[1]
if (cargoVersion !== packageJson.version) {
  throw new Error(
    `Pico package version ${packageJson.version} does not match Rust server ${cargoVersion ?? "unknown"}`
  )
}
const version = packageJson.version
const buildNumber =
  process.env.MACOS_BUILD_NUMBER ?? version.match(/^\d+(?:\.\d+){0,2}/)?.[0]
if (!buildNumber) {
  throw new Error("Set MACOS_BUILD_NUMBER to a valid numeric build version")
}
const outputRoot = resolve(
  root,
  process.env.PICO_MACOS_PACKAGE_DIR ?? "dist/macos"
)
const workRoot = join(outputRoot, "work")
const derivedData = join(workRoot, "DerivedData")
const menuScratch = join(workRoot, "PicoMenuBuild")
const appPath = join(outputRoot, "Pico.app")
const dmgPath = join(outputRoot, `Pico-${version}-universal.dmg`)
const dmgRoot = join(workRoot, "dmg")
const signingIdentity = process.env.MACOS_SIGN_IDENTITY ?? "-"
const notaryProfile = process.env.MACOS_NOTARY_PROFILE

function run(command, args, options = {}) {
  console.log(`+ ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? "no status"}`)
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`)
  }
  return result.stdout.trim()
}

function sign(path, entitlements) {
  const args = ["--force", "--sign", signingIdentity, "--options", "runtime"]
  if (signingIdentity !== "-") args.push("--timestamp")
  if (entitlements) args.push("--entitlements", entitlements)
  args.push(path)
  run("codesign", args)
}

function setBundleVersions(plistPath) {
  run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleShortVersionString ${version}`,
    "-c",
    `Set :CFBundleVersion ${buildNumber}`,
    plistPath,
  ])
}

function universal(outputPath, arm64Path, x64Path) {
  run("xcrun", ["lipo", "-create", arm64Path, x64Path, "-output", outputPath])
  chmodSync(outputPath, 0o755)
  const architectures = output("xcrun", ["lipo", "-archs", outputPath])
  if (!architectures.includes("arm64") || !architectures.includes("x86_64")) {
    throw new Error(
      `Universal binary is missing an architecture: ${outputPath}`
    )
  }
}

function copyPiRuntimeSupport(sourceRoot, destinationRoot) {
  for (const entry of readdirSync(sourceRoot)) {
    if (entry === "pi") continue
    cpSync(join(sourceRoot, entry), join(destinationRoot, entry), {
      recursive: true,
    })
  }
}

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(workRoot, { recursive: true })

run("pnpm", ["build"])
run("rustup", ["target", "add", "aarch64-apple-darwin", "x86_64-apple-darwin"])
for (const target of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
  run("cargo", [
    "build",
    "--release",
    "--locked",
    "--target",
    target,
    "-p",
    "pico-server",
  ])
}

const bridgeArm64 = join(workRoot, "pico-pi-bridge-arm64")
const bridgeX64 = join(workRoot, "pico-pi-bridge-x64")
run("pnpm", ["build:pi-bridge"], {
  env: {
    PICO_PI_BRIDGE_TARGET: "bun-darwin-arm64",
    PICO_PI_BRIDGE_OUTPUT: bridgeArm64,
  },
})
run("pnpm", ["build:pi-bridge"], {
  env: {
    PICO_PI_BRIDGE_TARGET: "bun-darwin-x64",
    PICO_PI_BRIDGE_OUTPUT: bridgeX64,
  },
})
for (const architecture of ["arm64", "x64"]) {
  run("node", ["scripts/fetch-pi-standalone.mjs"], {
    env: { PI_STANDALONE_TARGET: `darwin-${architecture}` },
  })
}

run("xcodebuild", [
  "-project",
  "apps/apple/Pico/Pico.xcodeproj",
  "-scheme",
  "Pico",
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=macOS",
  "-derivedDataPath",
  derivedData,
  "ARCHS=arm64 x86_64",
  "ONLY_ACTIVE_ARCH=NO",
  "CODE_SIGNING_ALLOWED=NO",
  "build",
])
const builtApp = join(derivedData, "Build/Products/Release/Pico.app")
if (!existsSync(builtApp)) throw new Error("Xcode did not produce Pico.app")
cpSync(builtApp, appPath, { recursive: true })
const appInfoPlist = join(appPath, "Contents/Info.plist")
setBundleVersions(appInfoPlist)
run("/usr/libexec/PlistBuddy", [
  "-c",
  `Add :PicoBackgroundServicesAvailable bool ${signingIdentity !== "-"}`,
  appInfoPlist,
])

run("swift", [
  "build",
  "--package-path",
  "apps/apple/PicoMenu",
  "--configuration",
  "release",
  "--scratch-path",
  menuScratch,
  "--arch",
  "arm64",
  "--arch",
  "x86_64",
])
const menuBinary = join(menuScratch, "apple/Products/Release/PicoMenu")
if (!existsSync(menuBinary)) {
  throw new Error(
    `SwiftPM did not produce the menu app binary at ${menuBinary}`
  )
}

const serverRoot = join(appPath, "Contents/Resources/PicoServer")
const launchAgentRoot = join(appPath, "Contents/Library/LaunchAgents")
const loginItemRoot = join(appPath, "Contents/Library/LoginItems")
mkdirSync(serverRoot, { recursive: true })
mkdirSync(launchAgentRoot, { recursive: true })
mkdirSync(loginItemRoot, { recursive: true })
universal(
  join(serverRoot, "pico-server"),
  join(root, "target/aarch64-apple-darwin/release/pico-server"),
  join(root, "target/x86_64-apple-darwin/release/pico-server")
)
universal(join(serverRoot, "pico-pi-bridge"), bridgeArm64, bridgeX64)
const piVersion = packageJson.devDependencies["@earendil-works/pi-coding-agent"]
const piRuntimeArm64 = join(root, `artifacts/pi/${piVersion}/darwin-arm64/pi`)
const piRuntimeX64 = join(root, `artifacts/pi/${piVersion}/darwin-x64/pi`)
const piArm64 = join(workRoot, "pi-arm64")
const piX64 = join(workRoot, "pi-x64")
cpSync(join(piRuntimeArm64, "pi"), piArm64)
cpSync(join(piRuntimeX64, "pi"), piX64)
// Pi's standalone archives contain modified Bun executables whose inherited
// signatures do not verify. Normalize temporary copies before lipo reads them.
sign(piArm64)
sign(piX64)
universal(join(serverRoot, "pi"), piArm64, piX64)
copyPiRuntimeSupport(piRuntimeArm64, serverRoot)
for (const required of [
  "package.json",
  "photon_rs_bg.wasm",
  "theme/dark.json",
  "theme/light.json",
]) {
  if (!existsSync(join(serverRoot, required))) {
    throw new Error(`Packaged Pi runtime omitted ${required}`)
  }
}
cpSync(join(root, ".output/public"), join(serverRoot, "web"), {
  recursive: true,
})
cpSync(
  join(root, "apps/apple/Pico/Pico/Resources/com.alivault.pico.server.plist"),
  join(launchAgentRoot, "com.alivault.pico.server.plist")
)

const menuApp = join(loginItemRoot, "PicoMenu.app")
mkdirSync(join(menuApp, "Contents/MacOS"), { recursive: true })
cpSync(menuBinary, join(menuApp, "Contents/MacOS/PicoMenu"))
chmodSync(join(menuApp, "Contents/MacOS/PicoMenu"), 0o755)
cpSync(
  join(root, "apps/apple/PicoMenu/Resources/Info.plist"),
  join(menuApp, "Contents/Info.plist")
)
setBundleVersions(join(menuApp, "Contents/Info.plist"))

for (const binary of ["pico-server", "pico-pi-bridge", "pi"]) {
  sign(join(serverRoot, binary))
}
const packagedPiVersion = output(join(serverRoot, "pi"), ["--version"])
if (packagedPiVersion !== piVersion) {
  throw new Error(
    `Packaged Pi reported ${packagedPiVersion || "no version"}; expected ${piVersion}`
  )
}
sign(menuApp)
const frameworksRoot = join(appPath, "Contents/Frameworks")
if (existsSync(frameworksRoot)) {
  const frameworks = output("find", [
    frameworksRoot,
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
  ])
  for (const framework of frameworks.split("\n").filter(Boolean))
    sign(framework)
}
sign(
  appPath,
  join(root, "apps/apple/Pico/Pico/Resources/Pico-macOS-Direct.entitlements")
)
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])

if (notaryProfile && signingIdentity !== "-") {
  const archive = join(workRoot, "Pico.zip")
  run("ditto", ["-c", "-k", "--keepParent", appPath, archive])
  run("xcrun", [
    "notarytool",
    "submit",
    archive,
    "--keychain-profile",
    notaryProfile,
    "--wait",
  ])
  run("xcrun", ["stapler", "staple", appPath])
}

mkdirSync(dmgRoot, { recursive: true })
cpSync(appPath, join(dmgRoot, "Pico.app"), { recursive: true })
symlinkSync("/Applications", join(dmgRoot, "Applications"))
run("hdiutil", [
  "create",
  "-volname",
  "Pico",
  "-srcfolder",
  dmgRoot,
  "-ov",
  "-format",
  "UDZO",
  dmgPath,
])
if (notaryProfile && signingIdentity !== "-") {
  run("xcrun", [
    "notarytool",
    "submit",
    dmgPath,
    "--keychain-profile",
    notaryProfile,
    "--wait",
  ])
  run("xcrun", ["stapler", "staple", dmgPath])
}

console.log(`Packaged app: ${appPath}`)
console.log(`Packaged DMG: ${dmgPath}`)
