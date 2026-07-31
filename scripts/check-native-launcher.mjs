#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { nativeAssetName } from "../bin/native-runtime.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporaryRoot = mkdtempSync(join(tmpdir(), "pico-native-launcher-"))
const server = join(temporaryRoot, "fake-server")
const log = join(temporaryRoot, "serve-args.txt")
const updateLog = join(temporaryRoot, "update-order.txt")
writeFileSync(
  server,
  `#!/bin/sh
if [ "$1" = status ]; then
  if [ "$FAKE_RUNNING" = 1 ]; then
    printf '%s\\n' '{"id":"test","ok":true,"status":{"version":"0.14.1","protocolVersion":2,"apiContractVersion":1,"host":"127.0.0.1","port":3141,"phase":"running","pid":42,"activeRunCount":0}}'
    exit 0
  fi
  exit 1
fi
if [ "$1" = stop ]; then
  printf '%s\\n' stop >> "$FAKE_UPDATE_LOG"
  exit 0
fi
printf '%s\\n' "$*" > "$FAKE_LOG"
`,
  { mode: 0o755 }
)
chmodSync(server, 0o755)

function launch(extraEnvironment = {}) {
  return spawnSync(
    process.execPath,
    ["bin/pico.mjs", "--no-open", "--port", "0"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PICO_SERVER_BIN: server,
        PICO_PI_BIN: "/tmp/fake-pi",
        PICO_PI_BRIDGE_BIN: "/tmp/fake-bridge",
        PICO_WEB_DIR: "/tmp/fake-web",
        PICO_DISABLE_NATIVE_DOWNLOAD: "1",
        FAKE_LOG: log,
        FAKE_UPDATE_LOG: updateLog,
        ...extraEnvironment,
      },
    }
  )
}

try {
  const started = launch()
  if (started.status !== 0) {
    throw new Error(started.stderr || "native launcher start failed")
  }
  const argumentsText = readFileSync(log, "utf8")
  for (const expected of [
    "serve",
    "--pi-bin /tmp/fake-pi",
    "--pi-bridge-bin /tmp/fake-bridge",
    "--web-dir /tmp/fake-web",
  ]) {
    if (!argumentsText.includes(expected)) {
      throw new Error(`native launcher omitted ${expected}`)
    }
  }

  writeFileSync(log, "not-started")
  const attached = launch({ FAKE_RUNNING: "1" })
  if (
    attached.status !== 0 ||
    !attached.stdout.includes("Using running Pico")
  ) {
    throw new Error(attached.stderr || "native launcher did not attach")
  }
  if (readFileSync(log, "utf8") !== "not-started") {
    throw new Error("native launcher started a duplicate server")
  }
  if (
    nativeAssetName("1.2.3", "darwin-arm64") !==
    "pico-native-1.2.3-darwin-arm64.tar.gz"
  ) {
    throw new Error("native release asset naming changed")
  }

  for (const [name, marker] of [
    ["npm", "update"],
    ["pico-app", "restart"],
  ]) {
    const path = join(temporaryRoot, name)
    writeFileSync(
      path,
      `#!/bin/sh\nprintf '%s\\n' ${marker} >> "$FAKE_UPDATE_LOG"\nif [ "${marker}" = update ] && [ "$FAKE_NPM_FAIL" = 1 ]; then exit 1; fi\n`,
      { mode: 0o755 }
    )
    chmodSync(path, 0o755)
  }
  writeFileSync(updateLog, "")
  const releaseManifest = encodeURIComponent(
    JSON.stringify({
      version: "0.14.2",
      serverProtocolVersion: 2,
      apiContractVersion: 1,
      assets: {},
    })
  )
  const updated = spawnSync(process.execPath, ["bin/pico.mjs", "update"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${temporaryRoot}:${process.env.PATH}`,
      npm_execpath: join(temporaryRoot, "npm"),
      npm_config_user_agent: "npm",
      PICO_SERVER_BIN: server,
      PICO_NATIVE_MANIFEST_URL: `data:application/json,${releaseManifest}`,
      PICO_DISABLE_NATIVE_DOWNLOAD: "1",
      FAKE_RUNNING: "1",
      FAKE_LOG: log,
      FAKE_UPDATE_LOG: updateLog,
    },
  })
  if (
    updated.status !== 0 ||
    !updated.stdout.includes("server is restarting")
  ) {
    throw new Error(updated.stderr || "safe native update simulation failed")
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const updateOrder = readFileSync(updateLog, "utf8").trim().split("\n")
  if (updateOrder.join(",") !== "stop,update,restart") {
    throw new Error(`unsafe update order: ${updateOrder.join(",")}`)
  }

  writeFileSync(updateLog, "")
  const failedUpdate = spawnSync(process.execPath, ["bin/pico.mjs", "update"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${temporaryRoot}:${process.env.PATH}`,
      npm_execpath: join(temporaryRoot, "npm"),
      npm_config_user_agent: "npm",
      PICO_SERVER_BIN: server,
      PICO_NATIVE_MANIFEST_URL: `data:application/json,${releaseManifest}`,
      PICO_DISABLE_NATIVE_DOWNLOAD: "1",
      FAKE_RUNNING: "1",
      FAKE_NPM_FAIL: "1",
      FAKE_LOG: log,
      FAKE_UPDATE_LOG: updateLog,
    },
  })
  if (failedUpdate.status === 0) {
    throw new Error("failed package update unexpectedly succeeded")
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const recoveryOrder = readFileSync(updateLog, "utf8").trim().split("\n")
  if (recoveryOrder.join(",") !== "stop,update,restart") {
    throw new Error(
      `failed update did not restart Pico: ${recoveryOrder.join(",")}`
    )
  }

  console.log("Native Pico launcher checks passed.")
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
