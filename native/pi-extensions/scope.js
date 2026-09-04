const WEB_RUN_TOOL = "web_run"

export function isOpenAICodexModel(model) {
  return model?.provider?.trim().toLowerCase() === "openai-codex"
}

export function reconcileWebRun(pi, model) {
  const registered = pi.getAllTools().some((tool) => tool.name === WEB_RUN_TOOL)
  if (!registered) return

  const active = pi.getActiveTools()
  const isActive = active.includes(WEB_RUN_TOOL)
  const shouldBeActive = isOpenAICodexModel(model)
  if (isActive === shouldBeActive) return

  pi.setActiveTools(
    shouldBeActive
      ? [...new Set([...active, WEB_RUN_TOOL])]
      : active.filter((name) => name !== WEB_RUN_TOOL)
  )
}
