import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { SidebarState } from "../src/core/sidebar-state.ts"
import { tempDir } from "./support.ts"

void test("sidebar state saves changes and reloads them", async () => {
  const file = join(await tempDir("pico-sidebar-"), "sidebar.json")
  const state = new SidebarState(file)
  assert.deepEqual(state.snapshot(), {
    projects: [],
    pinnedAgentKeys: [],
    collapsedProjects: {},
    revision: 0,
    initialized: false,
  })

  const saved = state.update({
    projects: [" /a ", "/b", "/a", "", 3],
    collapsedProjects: { "/a": true, "/b": false },
  })
  assert.deepEqual(saved.projects, ["/a", "/b"])
  assert.deepEqual(saved.collapsedProjects, { "/a": true })
  assert.deepEqual(saved.pinnedAgentKeys, [])
  assert.equal(saved.revision, 1)
  assert.equal(saved.initialized, true)

  // A partial change keeps the other fields.
  state.update({ pinnedAgentKeys: ["s1"] })
  const reloaded = new SidebarState(file).snapshot()
  assert.deepEqual(reloaded, {
    projects: ["/a", "/b"],
    pinnedAgentKeys: ["s1"],
    collapsedProjects: { "/a": true },
    revision: 2,
    initialized: true,
  })
})

void test("sidebar merge keeps the shared order first", async () => {
  const file = join(await tempDir("pico-sidebar-"), "sidebar.json")
  const state = new SidebarState(file)
  state.update({
    projects: ["/b", "/a"],
    pinnedAgentKeys: ["s1"],
    collapsedProjects: { "/a": true },
  })
  const merged = state.merge({
    projects: ["/c", "/a", "/d"],
    pinnedAgentKeys: ["s2", "s1"],
    collapsedProjects: { "/c": true },
  })
  assert.deepEqual(merged.projects, ["/b", "/a", "/c", "/d"])
  assert.deepEqual(merged.pinnedAgentKeys, ["s1", "s2"])
  assert.deepEqual(merged.collapsedProjects, { "/a": true, "/c": true })
  assert.equal(merged.revision, 2)
})

void test("sidebar state keeps the stored field names in its file", async () => {
  const file = join(await tempDir("pico-sidebar-"), "sidebar.json")
  writeFileSync(
    file,
    JSON.stringify({
      directories: ["/a"],
      pinnedSessionKeys: ["session:s1"],
      collapsedDirectories: { "/a": true },
      revision: 4,
    })
  )
  const state = new SidebarState(file)
  assert.deepEqual(state.snapshot().projects, ["/a"])
  assert.deepEqual(state.snapshot().pinnedAgentKeys, ["session:s1"])
  state.update({ projects: ["/a", "/b"] })
  const stored = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >
  assert.deepEqual(stored.directories, ["/a", "/b"])
  assert.deepEqual(stored.pinnedSessionKeys, ["session:s1"])
  assert.deepEqual(stored.collapsedDirectories, { "/a": true })
  assert.equal(stored.projects, undefined)
})
