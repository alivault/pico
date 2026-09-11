import type { ModelOption } from "@/lib/pico"

export function modelLabel(
  model: ModelOption | undefined,
  availableModels: ReadonlyArray<ModelOption>
): string {
  if (!model) return "Select model"
  // Saved session entries contain identity, not the runtime's display name.
  const catalogModel = availableModels.find(
    (entry) => entry.id === model.id && entry.provider === model.provider
  )
  return model.name || catalogModel?.name || model.id
}
