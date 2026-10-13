import { useQuery, useQueryClient } from "@tanstack/react-query"

import { usePicoEvent } from "@/features/pico/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"

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
  const queryClient = useQueryClient()
  usePicoEvent("pico:session-extensions", (detail) => {
    if (!sessionId || detail.sessionId !== sessionId) return
    void queryClient.invalidateQueries({
      queryKey: sessionExtensionsQueryKey(viewerContextId, sessionId),
    })
  })
  return useQuery({
    queryKey: sessionExtensionsQueryKey(viewerContextId, sessionId ?? ""),
    queryFn: async () => {
      const response = await fetchJson<SessionExtensionsResponse>(
        buildRequestUrl("/api/session/extensions", {
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

/** Send a JSON request to a session route. */
export function postSessionJson<T>(
  viewerContextId: string,
  sessionId: string | undefined,
  path: string,
  body: Record<string, unknown>
) {
  return fetchJson<T>(
    buildRequestUrl(path, { contextId: viewerContextId, sessionId }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  )
}
