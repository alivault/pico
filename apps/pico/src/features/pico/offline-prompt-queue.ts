import type { PromptImage, StreamingBehavior } from "@/lib/pico"

const OFFLINE_PROMPT_DB_NAME = "pico-offline-prompts"
const OFFLINE_PROMPT_DB_VERSION = 1
const OFFLINE_PROMPT_STORE_NAME = "prompts"
const OFFLINE_PROMPT_FALLBACK_STORAGE_KEY = "pico-offline-prompts"

export type OfflinePromptImage = Pick<PromptImage, "type" | "mimeType" | "data">

export type OfflinePromptQueueItem = {
  id: string
  contextId: string
  createdAt: number
  sessionId?: string
  targetSessionKey?: string
  message: string
  images: Array<OfflinePromptImage>
  streamingBehavior?: StreamingBehavior
  pendingId?: string
  clientRequestId: string
  thinkingLevel?: string
  draftOwnerKey?: string
  draftCwd?: string
}

let dbPromise: Promise<IDBDatabase | null> | undefined

function hasIndexedDb() {
  return typeof indexedDB !== "undefined"
}

function openOfflinePromptDb() {
  if (!hasIndexedDb()) return Promise.resolve(null)
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(
      OFFLINE_PROMPT_DB_NAME,
      OFFLINE_PROMPT_DB_VERSION
    )

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_PROMPT_STORE_NAME)) {
        db.createObjectStore(OFFLINE_PROMPT_STORE_NAME, { keyPath: "id" })
      }
    }

    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

function fallbackItems() {
  try {
    const raw = window.localStorage.getItem(OFFLINE_PROMPT_FALLBACK_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeItems(parsed) : []
  } catch {
    return []
  }
}

function rememberFallbackItems(items: Array<OfflinePromptQueueItem>) {
  try {
    window.localStorage.setItem(
      OFFLINE_PROMPT_FALLBACK_STORAGE_KEY,
      JSON.stringify(items)
    )
  } catch {
    // Ignore fallback persistence failures.
  }
}

function normalizeImage(value: unknown): OfflinePromptImage | null {
  if (!value || typeof value !== "object") return null
  const rawImage = value as Partial<OfflinePromptImage>
  if (typeof rawImage.mimeType !== "string") return null
  if (typeof rawImage.data !== "string") return null

  return {
    type: "image",
    mimeType: rawImage.mimeType,
    data: rawImage.data,
  }
}

function normalizeItem(value: unknown): OfflinePromptQueueItem | null {
  if (!value || typeof value !== "object") return null

  const rawItem = value as Partial<OfflinePromptQueueItem>
  if (typeof rawItem.id !== "string" || !rawItem.id) return null
  if (typeof rawItem.contextId !== "string" || !rawItem.contextId) return null
  if (typeof rawItem.message !== "string") return null
  if (typeof rawItem.clientRequestId !== "string") return null

  const images = Array.isArray(rawItem.images)
    ? rawItem.images.flatMap((image) => {
        const normalizedImage = normalizeImage(image)
        return normalizedImage ? [normalizedImage] : []
      })
    : []

  return {
    id: rawItem.id,
    contextId: rawItem.contextId,
    createdAt:
      typeof rawItem.createdAt === "number" &&
      Number.isFinite(rawItem.createdAt)
        ? rawItem.createdAt
        : Date.now(),
    sessionId:
      typeof rawItem.sessionId === "string" ? rawItem.sessionId : undefined,
    targetSessionKey:
      typeof rawItem.targetSessionKey === "string"
        ? rawItem.targetSessionKey
        : undefined,
    message: rawItem.message,
    images,
    streamingBehavior:
      rawItem.streamingBehavior === "followUp" ||
      rawItem.streamingBehavior === "steer"
        ? rawItem.streamingBehavior
        : undefined,
    pendingId:
      typeof rawItem.pendingId === "string" ? rawItem.pendingId : undefined,
    clientRequestId: rawItem.clientRequestId,
    thinkingLevel:
      typeof rawItem.thinkingLevel === "string"
        ? rawItem.thinkingLevel
        : undefined,
    draftOwnerKey:
      typeof rawItem.draftOwnerKey === "string"
        ? rawItem.draftOwnerKey
        : undefined,
    draftCwd:
      typeof rawItem.draftCwd === "string" ? rawItem.draftCwd : undefined,
  }
}

function normalizeItems(values: Array<unknown>) {
  return values
    .flatMap((value) => {
      const normalizedItem = normalizeItem(value)
      return normalizedItem ? [normalizedItem] : []
    })
    .sort((left, right) => left.createdAt - right.createdAt)
}

export async function enqueueOfflinePrompt(item: OfflinePromptQueueItem) {
  const db = await openOfflinePromptDb()
  if (!db) {
    const items = fallbackItems().filter((entry) => entry.id !== item.id)
    items.push(item)
    rememberFallbackItems(normalizeItems(items))
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OFFLINE_PROMPT_STORE_NAME, "readwrite")
    const store = transaction.objectStore(OFFLINE_PROMPT_STORE_NAME)
    const request = store.put(item)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function readOfflinePrompts(contextId?: string) {
  const db = await openOfflinePromptDb()
  if (!db) {
    const items = fallbackItems()
    return contextId
      ? items.filter((item) => item.contextId === contextId)
      : items
  }

  const items = await new Promise<Array<OfflinePromptQueueItem>>(
    (resolve, reject) => {
      const transaction = db.transaction(OFFLINE_PROMPT_STORE_NAME, "readonly")
      const store = transaction.objectStore(OFFLINE_PROMPT_STORE_NAME)
      const request = store.getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(normalizeItems(request.result))
      transaction.onerror = () => reject(transaction.error)
    }
  )

  return contextId
    ? items.filter((item) => item.contextId === contextId)
    : items
}

export async function removeOfflinePrompt(id: string) {
  const db = await openOfflinePromptDb()
  if (!db) {
    rememberFallbackItems(fallbackItems().filter((item) => item.id !== id))
    return
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OFFLINE_PROMPT_STORE_NAME, "readwrite")
    const store = transaction.objectStore(OFFLINE_PROMPT_STORE_NAME)
    const request = store.delete(id)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}
