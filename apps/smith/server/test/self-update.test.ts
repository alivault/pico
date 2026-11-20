import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import {
  compareVersions,
  detectInstall,
  installCommand,
  latestOnChannel,
  readUpdateConfig,
  writeUpdateConfig,
} from "../src/services/self-update.ts"
import { tempDir } from "./support.ts"

void test("versions sort like semver", () => {
  const sorted = [
    "2.10.0",
    "2.7.2",
    "2.8.0-beta.10",
    "2.8.0-beta.2",
    "2.8.0",
    "2.8.0-alpha",
    "2.7.10",
  ].sort(compareVersions)
  assert.deepEqual(sorted, [
    "2.7.2",
    "2.7.10",
    "2.8.0-alpha",
    "2.8.0-beta.2",
    "2.8.0-beta.10",
    "2.8.0",
    "2.10.0",
  ])
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0)
})

void test("the preview channel takes the newer of next and latest", () => {
  const tags = { latest: "2.8.0", next: "2.8.0-beta.3" }
  assert.equal(latestOnChannel(tags, "stable"), "2.8.0")
  assert.equal(latestOnChannel(tags, "preview"), "2.8.0")
  assert.equal(
    latestOnChannel({ latest: "2.8.0", next: "2.9.0-beta.1" }, "preview"),
    "2.9.0-beta.1"
  )
  assert.equal(
    latestOnChannel({ latest: "2.8.0", next: "2.9.0-beta.1" }, "stable"),
    "2.8.0"
  )
  assert.throws(() => latestOnChannel({}, "stable"), /no stable version/)
})

void test("the install kind comes from where the package is", async () => {
  // macOS: the temporary directory is behind a symlink.
  const dir = realpathSync(await tempDir("pico-update-test-"))
  const pkg = (path: string) => {
    mkdirSync(path, { recursive: true })
    return path
  }
  const global = pkg(join(dir, "prefix/lib/node_modules/@alivault/pico"))
  assert.deepEqual(detectInstall(global, "darwin"), {
    kind: "npm",
    root: global,
    prefix: join(dir, "prefix"),
  })
  assert.equal(
    installCommand(detectInstall(global, "darwin"), "2.8.0"),
    `npm install --global --prefix ${join(dir, "prefix")} @alivault/pico@2.8.0`
  )
  const local = pkg(join(dir, "project/node_modules/@alivault/pico"))
  assert.equal(detectInstall(local, "darwin").kind, "other")
  const pnpm = pkg(
    join(dir, "g/.pnpm/@alivault+pico@2/node_modules/@alivault/pico")
  )
  assert.equal(detectInstall(pnpm, "darwin").kind, "other")
  const source = pkg(join(dir, "repo/apps/pico"))
  mkdirSync(join(source, "server/src"), { recursive: true })
  writeFileSync(join(source, "server/src/main.ts"), "")
  assert.equal(detectInstall(source, "darwin").kind, "source")
})

void test("the update settings survive a bad file", async () => {
  const dir = await tempDir("pico-update-test-")
  assert.deepEqual(readUpdateConfig(dir), { channel: "stable", check: true })
  writeUpdateConfig(dir, { channel: "preview" })
  writeUpdateConfig(dir, { check: false })
  assert.deepEqual(readUpdateConfig(dir), { channel: "preview", check: false })
  writeFileSync(join(dir, "update.json"), '{"channel":"nightly"}')
  assert.deepEqual(readUpdateConfig(dir), { channel: "stable", check: true })
})

void test("the CLI shows and sets the channel", async () => {
  const data = await tempDir("pico-update-test-")
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["dist/pico-server.mjs", ...args, "--data-dir", data],
      { encoding: "utf8" }
    )
  assert.equal(run("channel").stdout.trim(), "stable")
  assert.equal(run("channel", "set", "preview").status, 0)
  assert.equal(run("channel", "show").stdout.trim(), "preview")
  assert.equal(run("channel", "set", "nightly").status, 2)
})

void test("the server checks the registry and reports the update", async () => {
  const registry = createServer((request, response) => {
    assert.equal(request.url, "/-/package/@alivault%2fpico/dist-tags")
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ latest: "999.0.0", next: "999.1.0-beta.1" }))
  })
  await new Promise<void>((done) => registry.listen(0, "127.0.0.1", done))
  const registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`
  const data = await tempDir("pico-update-test-")
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: join(data, "agent"),
    PICO_NPM_REGISTRY: registryUrl,
  }
  const child = spawn(
    process.execPath,
    [
      "dist/pico-server.mjs",
      "serve",
      "--port",
      "0",
      "--data-dir",
      data,
      "--web-dir",
      "none",
    ],
    { env, stdio: "ignore" }
  )
  const exited = new Promise<void>((done) => child.once("exit", () => done()))
  try {
    let url = ""
    for (let i = 0; i < 200 && !url; i++) {
      try {
        const state = JSON.parse(
          await readFile(join(data, "server.json"), "utf8")
        ) as { port: number }
        const candidate = `http://127.0.0.1:${state.port}`
        if ((await fetch(`${candidate}/api/system/health`)).ok) url = candidate
      } catch {
        await new Promise((done) => setTimeout(done, 100))
      }
    }
    assert.ok(url, "the server did not start")
    const post = (path: string, body?: unknown) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
    type Status = {
      install: string
      channel: string
      latest?: string
      available: boolean
      command?: string
    }
    const checked = (await (
      await post("/api/system/update/check")
    ).json()) as Status
    // Tests run the server from the repository.
    assert.equal(checked.install, "source")
    assert.equal(checked.latest, "999.0.0")
    assert.equal(checked.available, true)
    assert.match(checked.command ?? "", /git pull/)
    const health = (await (await fetch(`${url}/api/system/health`)).json()) as {
      release?: { available: boolean; latest?: string }
    }
    assert.deepEqual(health.release, {
      available: true,
      installing: false,
      canInstall: false,
      latest: "999.0.0",
    })
    // A source checkout does not install itself.
    assert.equal((await post("/api/system/update/install")).status, 409)
    const preview = (await (
      await post("/api/system/update/settings", { channel: "preview" })
    ).json()) as Status
    assert.equal(preview.channel, "preview")
    assert.equal(preview.latest, undefined)
    const again = (await (
      await post("/api/system/update/check")
    ).json()) as Status
    assert.equal(again.latest, "999.1.0-beta.1")
    assert.equal(
      (await post("/api/system/update/settings", { channel: "nightly" }))
        .status,
      400
    )
  } finally {
    child.kill("SIGTERM")
    await exited
    registry.close()
  }
})
