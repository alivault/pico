import { useQuery, useQueryClient } from "@tanstack/react-query"

import { useSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useToolRenderContext } from "@/features/smith/tool-renderers/registry"
import { useMachineId } from "@/lib/smith/machine-context"

/** One value for each Agent panel state provider on the server. */
export type AgentExtensionState = Record<string, unknown>

type AgentExtensionsResponse = {
  ok: true
  agentId: string
  state: AgentExtensionState
}

export function agentExtensionsQueryKey(
  viewerContextId: string,
  agentId: string
) {
  return ["smith", "agent-extensions", viewerContextId, agentId] as const
}

/** The Agent panel state of an agent, read again when the server says it changed. */
export function useAgentExtensions(
  viewerContextId: string,
  agentId: string | undefined,
  enabled = true
) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  useSmithEvent("smith:agent-extensions", (detail) => {
    if (!agentId || (detail.agentId !== agentId && detail.agentId !== "*"))
      return
    void queryClient.invalidateQueries({
      queryKey: agentExtensionsQueryKey(viewerContextId, agentId),
    })
  })
  return useQuery({
    queryKey: agentExtensionsQueryKey(viewerContextId, agentId ?? ""),
    queryFn: async () => {
      const response = await fetchJson<AgentExtensionsResponse>(
        buildRequestUrl("/api/agent/extensions", {
          machineId,
          contextId: viewerContextId,
          agentId,
        })
      )
      return response.state
    },
    enabled: Boolean(enabled && viewerContextId && agentId),
    staleTime: 30_000,
  })
}

/** Whether the shown agent waits for an answer from the user. */
export function useWaitingForAnswer() {
  const { viewerContextId, agentId } = useToolRenderContext()
  const query = useAgentExtensions(viewerContextId, agentId)
  const questions = query.data?.questions
  return Array.isArray(questions) && questions.length > 0
}

/** Send a JSON request to an agent route. */
export function postAgentJson<T>(
  machineId: string,
  viewerContextId: string,
  agentId: string | undefined,
  path: string,
  body: Record<string, unknown>
) {
  return fetchJson<T>(
    buildRequestUrl(path, { machineId, contextId: viewerContextId, agentId }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  )
}
