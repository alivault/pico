import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import { SidebarState } from "../src/core/sidebar-state.ts"
import { tempDir } from "./support.ts"

void test("sidebar state saves changes and reloads them", async () => {
  const file = join(await tempDir("pico-sidebar-"), "sidebar.json")
  const state = new SidebarState(file)
  assert.deepEqual(state.snapshot(), {
    directories: [],
    pinnedSessionKeys: [],
    collapsedDirectories: {},
    revision: 0,
    initialized: false,
  })

  const saved = state.update({
    directories: [" /a ", "/b", "/a", "", 3],
    collapsedDirectories: { "/a": true, "/b": false },
  })
  assert.deepEqual(saved.directories, ["/a", "/b"])
  assert.deepEqual(saved.collapsedDirectories, { "/a": true })
  assert.deepEqual(saved.pinnedSessionKeys, [])
  assert.equal(saved.revision, 1)
  assert.equal(saved.initialized, true)

  // A partial change keeps the other fields.
  state.update({ pinnedSessionKeys: ["s1"] })
  const reloaded = new SidebarState(file).snapshot()
  assert.deepEqual(reloaded, {
    directories: ["/a", "/b"],
    pinnedSessionKeys: ["s1"],
    collapsedDirectories: { "/a": true },
    revision: 2,
    initialized: true,
  })
})

void test("sidebar merge keeps the shared order first", async () => {
  const file = join(await tempDir("pico-sidebar-"), "sidebar.json")
  const state = new SidebarState(file)
  state.update({
    directories: ["/b", "/a"],
    pinnedSessionKeys: ["s1"],
    collapsedDirectories: { "/a": true },
  })
  const merged = state.merge({
    directories: ["/c", "/a", "/d"],
    pinnedSessionKeys: ["s2", "s1"],
    collapsedDirectories: { "/c": true },
  })
  assert.deepEqual(merged.directories, ["/b", "/a", "/c", "/d"])
  assert.deepEqual(merged.pinnedSessionKeys, ["s1", "s2"])
  assert.deepEqual(merged.collapsedDirectories, { "/a": true, "/c": true })
  assert.equal(merged.revision, 2)
})
