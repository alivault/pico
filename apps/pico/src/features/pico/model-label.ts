import type { ModelOption } from "@/lib/pico"

export function modelLabel(
  model: ModelOption | undefined,
  availableModels: ReadonlyArray<ModelOption>
): string {
  if (!model) return "Select model"
  // Saved agent entries contain identity, not the runtime's display name.
  const catalogModel = availableModels.find(
    (entry) => entry.id === model.id && entry.provider === model.provider
  )
  return model.name || catalogModel?.name || model.id
}

/**
 * The first word and its space (as "Claude ") when every name starts with it,
 * or "". One name alone keeps its full text.
 */
function sharedFirstWord(names: Array<string>) {
  if (names.length < 2) return ""
  const prefix = `${names[0]!.split(" ")[0]} `
  return names.every(
    (name) => name.startsWith(prefix) && name.length > prefix.length
  )
    ? prefix
    : ""
}

export function withoutPrefix(name: string, prefix: string) {
  return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/** For each provider, the family word that all its model names share. */
export function modelFamilyPrefixes(
  availableModels: ReadonlyArray<ModelOption>
) {
  const names = new Map<string, Array<string>>()
  for (const entry of availableModels) {
    const provider = entry.provider || "Models"
    names.set(provider, [
      ...(names.get(provider) ?? []),
      entry.name || entry.id,
    ])
  }
  return new Map(
    [...names].map(([provider, list]) => [provider, sharedFirstWord(list)])
  )
}

/** The model name without the family word, as "Opus 5.5". */
export function shortModelLabel(
  model: ModelOption | undefined,
  availableModels: ReadonlyArray<ModelOption>
) {
  return withoutPrefix(
    modelLabel(model, availableModels),
    modelFamilyPrefixes(availableModels).get(model?.provider || "Models") ?? ""
  )
}

export function thinkingLabel(level: string) {
  switch (level) {
    case "off":
      return "Off"
    case "minimal":
      return "Minimal"
    case "low":
      return "Low"
    case "medium":
      return "Medium"
    case "high":
      return "High"
    case "xhigh":
      return "Extra High"
    case "max":
      return "Max"
    default:
      return level
  }
}
