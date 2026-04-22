type PendingUiRequest = {
  resolve: (value: Record<string, unknown>) => void
}

export function createUiRequestBridge(options: {
  entryKey: string
  pendingUiRequests: Map<string, PendingUiRequest>
  createRequestId: () => string
  broadcastToViewers: (sessionKey: string, payload: unknown) => void
}) {
  const { entryKey, pendingUiRequests, createRequestId, broadcastToViewers } =
    options

  const createDialogPromise = <T>(
    defaultValue: T,
    request: {
      signal?: AbortSignal
      timeout?: number
      payload: Record<string, unknown>
    },
    parseResponse: (response: Record<string, unknown>) => T
  ) => {
    if (request.signal?.aborted) return Promise.resolve(defaultValue)
    const id = createRequestId()
    return new Promise<T>((resolve) => {
      let timeoutId: NodeJS.Timeout | undefined
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId)
        request.signal?.removeEventListener("abort", onAbort)
        pendingUiRequests.delete(id)
      }
      const onAbort = () => {
        cleanup()
        resolve(defaultValue)
      }
      request.signal?.addEventListener("abort", onAbort, { once: true })
      if (request.timeout) {
        timeoutId = setTimeout(() => {
          cleanup()
          resolve(defaultValue)
        }, request.timeout)
      }
      pendingUiRequests.set(id, {
        resolve: (response) => {
          cleanup()
          resolve(parseResponse(response))
        },
      })
      broadcastToViewers(entryKey, {
        type: "extension_ui_request",
        id,
        ...request.payload,
      })
    })
  }

  const notify = (message: string, type = "info") => {
    broadcastToViewers(entryKey, {
      type: "extension_ui_request",
      id: createRequestId(),
      method: "notify",
      message,
      notifyType: type,
    })
  }

  return {
    createDialogPromise,
    notify,
  }
}

export function resolvePendingUiRequest(
  pendingUiRequests: Map<string, PendingUiRequest>,
  id: string,
  body: Record<string, unknown>
) {
  const pending = pendingUiRequests.get(id)
  if (!pending) {
    throw new Error(`Unknown UI request id: ${id}`)
  }
  pending.resolve(body)
  return { ok: true }
}
