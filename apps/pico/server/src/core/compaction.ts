/**
 * Automatic compaction at a fixed token level.
 *
 * pi-durable starts a blocking compaction above `contextWindow - reserveTokens`,
 * and a background compaction `backgroundTokens` before that. It has no fixed
 * level, so Pico sets `reserveTokens` for each model to put the blocking
 * threshold at `compactAtTokens`. Pi's own `compaction.modelOverrides` apply
 * first; a model whose window is smaller than the level keeps its own reserve.
 */
import {
  DEFAULT_COMPACTION_POLICY,
  type CompactionPolicy,
  type CompactionSettings,
} from "@earendil-works/pi-durable"

/** Pi's compaction settings for a model, or the global ones without a model. */
export type PiCompaction = (model?: { provider: string; id: string }) => {
  enabled: boolean
  reserveTokens: number
  keepRecentTokens: number
}

export type CompactionModel = {
  provider: string
  id: string
  contextWindow: number
}

/** The reserve that puts the blocking threshold at `compactAtTokens`. */
export function reserveForLevel(
  contextWindow: number,
  reserveTokens: number,
  compactAtTokens: number
) {
  if (compactAtTokens <= 0 || contextWindow <= 0) return reserveTokens
  return Math.max(reserveTokens, contextWindow - compactAtTokens)
}

/** The harness compaction settings: Pi's settings, with the fixed level. */
export function compactionSettings(
  pi: PiCompaction,
  models: readonly CompactionModel[],
  compactAtTokens: number
): CompactionSettings {
  const base = pi()
  const modelOverrides: Record<string, Partial<CompactionPolicy>> = {}
  for (const model of models) {
    const own = pi(model)
    const reserveTokens = reserveForLevel(
      model.contextWindow,
      own.reserveTokens,
      compactAtTokens
    )
    if (
      reserveTokens === base.reserveTokens &&
      own.keepRecentTokens === base.keepRecentTokens
    )
      continue
    modelOverrides[`${model.provider}/${model.id}`] = {
      reserveTokens,
      keepRecentTokens: own.keepRecentTokens,
    }
  }
  return {
    enabled: base.enabled,
    reserveTokens: base.reserveTokens,
    keepRecentTokens: base.keepRecentTokens,
    modelOverrides,
  }
}

/** The policy for one model, resolved the same way as pi-durable does. */
export function modelCompactionPolicy(
  settings: CompactionSettings,
  model: { provider: string; modelId: string }
): CompactionPolicy {
  const { modelOverrides, ...global } = settings
  const policy = { ...DEFAULT_COMPACTION_POLICY, ...global }
  const override = modelOverrides?.[`${model.provider}/${model.modelId}`]
  return { ...policy, ...override }
}

/**
 * The token counts where compaction starts for a context window: `compactAt`
 * blocks the turn, `backgroundAt` starts a summary while the turn continues.
 */
export function compactionLevels(
  policy: CompactionPolicy,
  contextWindow: number
) {
  if (!policy.enabled || contextWindow <= 0) return undefined
  const compactAt = contextWindow - policy.reserveTokens
  if (compactAt <= 0) return undefined
  const backgroundAt =
    policy.backgroundTokens > 0
      ? Math.max(0, compactAt - policy.backgroundTokens)
      : undefined
  return { compactAt, ...(backgroundAt ? { backgroundAt } : {}) }
}
