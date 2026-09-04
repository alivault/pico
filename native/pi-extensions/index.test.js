import assert from "node:assert/strict"
import test from "node:test"

import { isOpenAICodexModel, reconcileWebRun } from "./scope.js"

function fakePi(activeTools) {
  let active = [...activeTools]
  return {
    getActiveTools: () => [...active],
    getAllTools: () => [{ name: "read" }, { name: "web_run" }],
    setActiveTools: (tools) => {
      active = [...tools]
    },
  }
}

void test("recognizes every model on the OpenAI Codex provider", () => {
  assert.equal(isOpenAICodexModel({ provider: "openai-codex" }), true)
  assert.equal(isOpenAICodexModel({ provider: " OpenAI-Codex " }), true)
  assert.equal(isOpenAICodexModel({ provider: "openai" }), false)
})

void test("keeps web_run active only for OpenAI Codex models", () => {
  const pi = fakePi(["read"])
  reconcileWebRun(pi, { provider: "openai-codex" })
  assert.deepEqual(pi.getActiveTools(), ["read", "web_run"])

  reconcileWebRun(pi, { provider: "anthropic" })
  assert.deepEqual(pi.getActiveTools(), ["read"])
})
