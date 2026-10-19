import { useQuery, useQueryClient } from "@tanstack/react-query"

import { usePicoEvent } from "@/features/pico/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useToolRenderContext } from "@/features/pico/tool-renderers/registry"
import { useMachineId } from "@/lib/pico/machine-context"

/** One value for each Agent panel state provider on the server. */
export type SessionExtensionState = Record<string, unknown>

type SessionExtensionsResponse = {
  ok: true
  sessionId: string
  state: SessionExtensionState
}

export function sessionExtensionsQueryKey(
  viewerContextId: string,
  sessionId: string
) {
  return ["pico", "session-extensions", viewerContextId, sessionId] as const
}

/** The Agent panel state of a session, read again when the server says it changed. */
export function useSessionExtensions(
  viewerContextId: string,
  sessionId: string | undefined,
  enabled = true
) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  usePicoEvent("pico:session-extensions", (detail) => {
    if (
      !sessionId ||
      (detail.sessionId !== sessionId && detail.sessionId !== "*")
    )
      return
    void queryClient.invalidateQueries({
      queryKey: sessionExtensionsQueryKey(viewerContextId, sessionId),
    })
  })
  return useQuery({
    queryKey: sessionExtensionsQueryKey(viewerContextId, sessionId ?? ""),
    queryFn: async () => {
      const response = await fetchJson<SessionExtensionsResponse>(
        buildRequestUrl("/api/session/extensions", {
          machineId,
          contextId: viewerContextId,
          sessionId,
        })
      )
      return response.state
    },
    enabled: Boolean(enabled && viewerContextId && sessionId),
    staleTime: 30_000,
  })
}

/** Whether the agent of the shown session waits for an answer from the user. */
export function useWaitingForAnswer() {
  const { viewerContextId, sessionId } = useToolRenderContext()
  const query = useSessionExtensions(viewerContextId, sessionId)
  const questions = query.data?.questions
  return Array.isArray(questions) && questions.length > 0
}

/** Send a JSON request to a session route. */
export function postSessionJson<T>(
  machineId: string,
  viewerContextId: string,
  sessionId: string | undefined,
  path: string,
  body: Record<string, unknown>
) {
  return fetchJson<T>(
    buildRequestUrl(path, { machineId, contextId: viewerContextId, sessionId }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  )
}
