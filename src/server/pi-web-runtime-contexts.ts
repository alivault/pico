type ContextStateLike = {
  id: string
  activeKey?: string
  draftKey?: string
  sessionScope: string
  unreadFinished: Set<string>
}

type SessionEntryLike = {
  key: string
}

type SseClientLike = {
  closed: boolean
  controller: ReadableStreamDefaultController<Uint8Array>
}

export function normalizeSessionScope(
  rawScope: string | null,
  defaultCwd: string
) {
  const normalized = typeof rawScope === "string" ? rawScope.trim() : ""
  return normalized || defaultCwd
}

export function resolveScopeCwd(
  scope: string | null | undefined,
  defaultCwd: string
) {
  return normalizeSessionScope(scope ?? null, defaultCwd)
}

export function getSsePayloadText(payload: unknown) {
  const json = JSON.stringify(payload)
  const lines = json.split(/\r?\n/)
  return `${lines.map((line) => `data: ${line}`).join("\n")}\n\n`
}

export function writeRawToClient(options: {
  encoder: TextEncoder
  context: { clients: Set<SseClientLike> }
  client: SseClientLike
  text: string
  closeSseClient: (
    context: { clients: Set<SseClientLike> },
    client: SseClientLike
  ) => void
}) {
  const { encoder, context, client, text, closeSseClient } = options
  if (client.closed) return false
  try {
    client.controller.enqueue(encoder.encode(text))
    return true
  } catch {
    closeSseClient(context, client)
    return false
  }
}

export function sendPayloadToClient(options: {
  encoder: TextEncoder
  context: { clients: Set<SseClientLike> }
  client: SseClientLike
  payload: unknown
  closeSseClient: (
    context: { clients: Set<SseClientLike> },
    client: SseClientLike
  ) => void
}) {
  const { context, client, payload, closeSseClient, encoder } = options
  return writeRawToClient({
    encoder,
    context,
    client,
    text: getSsePayloadText(payload),
    closeSseClient,
  })
}

export async function activateContextSession<
  C extends ContextStateLike,
  E extends SessionEntryLike,
>(options: {
  context: C
  entry: E
  getSessionEntryByKey: (key: string) => E | undefined
  isDraftEntry: (entry: E) => boolean
  disposeDraftIfUnused: (entry: E | undefined) => Promise<void>
  getSessionPath: (entry: E) => string
  sendStateToContext: (context: C) => void
  sendSessionsToContext: (context: C) => Promise<void>
  afterActiveChanged?: (context: C) => Promise<void>
  notify?: boolean
}) {
  const {
    context,
    entry,
    getSessionEntryByKey,
    isDraftEntry,
    disposeDraftIfUnused,
    getSessionPath,
    sendStateToContext,
    sendSessionsToContext,
    afterActiveChanged,
    notify = true,
  } = options

  const previousDraft =
    context.draftKey && context.draftKey !== entry.key
      ? getSessionEntryByKey(context.draftKey)
      : undefined
  context.activeKey = entry.key
  if (context.draftKey && context.draftKey !== entry.key) {
    context.draftKey = undefined
    await disposeDraftIfUnused(previousDraft)
  }
  if (isDraftEntry(entry)) {
    context.draftKey = entry.key
  }
  await afterActiveChanged?.(context)
  context.unreadFinished.delete(getSessionPath(entry))
  if (!notify) {
    return
  }

  sendStateToContext(context)
  await sendSessionsToContext(context)
}

export async function clearContextDraft<
  C extends ContextStateLike,
  E extends SessionEntryLike,
>(options: {
  context: C
  getSessionEntryByKey: (key: string) => E | undefined
  disposeDraftIfUnused: (entry: E | undefined) => Promise<void>
}) {
  const { context, getSessionEntryByKey, disposeDraftIfUnused } = options
  const draftEntry = context.draftKey
    ? getSessionEntryByKey(context.draftKey)
    : undefined
  if (context.activeKey === context.draftKey) {
    context.activeKey = undefined
  }
  context.draftKey = undefined
  await disposeDraftIfUnused(draftEntry)
}

export async function resolveRequestedEntry<
  C extends ContextStateLike,
  E extends SessionEntryLike,
>(options: {
  url: URL
  context: C
  getSessionEntryByKey: (key: string) => E | undefined
  ensureSessionEntryById: (sessionId: string) => Promise<E | undefined>
  getActiveEntry: (context: C) => E | undefined
  getOrCreateDraftEntry: (context: C) => Promise<E>
  activateContextSession: (
    context: C,
    entry: E,
    options?: { notify?: boolean }
  ) => Promise<void>
  notifyOnActivate?: boolean
}) {
  const {
    url,
    context,
    getSessionEntryByKey,
    ensureSessionEntryById,
    getActiveEntry,
    getOrCreateDraftEntry,
    activateContextSession,
    notifyOnActivate = true,
  } = options

  const activateRequestedEntry = async (entry: E) => {
    await activateContextSession(context, entry, {
      notify: notifyOnActivate,
    })
    return entry
  }

  const requestedSessionKey = url.searchParams.get("sessionKey")
  if (requestedSessionKey) {
    const requestedEntry = getSessionEntryByKey(requestedSessionKey)
    if (requestedEntry) {
      return await activateRequestedEntry(requestedEntry)
    }
  }

  const requestedSessionId = url.searchParams.get("session")
  if (requestedSessionId) {
    const requestedEntry = await ensureSessionEntryById(requestedSessionId)
    if (requestedEntry) {
      return await activateRequestedEntry(requestedEntry)
    }
  }

  const activeEntry = getActiveEntry(context)
  if (activeEntry) {
    return await activateRequestedEntry(activeEntry)
  }

  return await getOrCreateDraftEntry(context)
}
