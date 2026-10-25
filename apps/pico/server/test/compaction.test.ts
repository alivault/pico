import assert from "node:assert/strict"
import { test } from "node:test"

import {
  compactionLevels,
  compactionSettings,
  modelCompactionPolicy,
  type PiCompaction,
} from "../src/core/compaction.ts"

const pi: PiCompaction = (model) => ({
  enabled: true,
  reserveTokens: model?.id === "tuned" ? 50_000 : 16_384,
  keepRecentTokens: 20_000,
})

const models = [
  { provider: "a", id: "small", contextWindow: 128_000 },
  { provider: "a", id: "large", contextWindow: 1_000_000 },
  { provider: "a", id: "tuned", contextWindow: 1_000_000 },
]

void test("without a level, only Pi's own overrides apply", () => {
  const settings = compactionSettings(pi, models, 0)
  assert.equal(settings.reserveTokens, 16_384)
  assert.deepEqual(settings.modelOverrides, {
    "a/tuned": { reserveTokens: 50_000, keepRecentTokens: 20_000 },
  })
})

void test("a level sets the blocking threshold on large windows", () => {
  const settings = compactionSettings(pi, models, 200_000)
  const large = modelCompactionPolicy(settings, {
    provider: "a",
    modelId: "large",
  })
  assert.equal(large.reserveTokens, 800_000)
  assert.deepEqual(compactionLevels(large, 1_000_000), {
    compactAt: 200_000,
    backgroundAt: 200_000 - 32_768,
  })

  // A window smaller than the level keeps its normal threshold.
  const small = modelCompactionPolicy(settings, {
    provider: "a",
    modelId: "small",
  })
  assert.equal(small.reserveTokens, 16_384)
  assert.equal(compactionLevels(small, 128_000)?.compactAt, 111_616)

  // A model that is not in the catalog uses the global policy.
  const unknown = modelCompactionPolicy(settings, {
    provider: "b",
    modelId: "x",
  })
  assert.equal(unknown.reserveTokens, 16_384)
})

void test("no levels when compaction is off", () => {
  const settings = compactionSettings(
    () => ({ enabled: false, reserveTokens: 16_384, keepRecentTokens: 20_000 }),
    models,
    200_000
  )
  const policy = modelCompactionPolicy(settings, {
    provider: "a",
    modelId: "large",
  })
  assert.equal(compactionLevels(policy, 1_000_000), undefined)
})
