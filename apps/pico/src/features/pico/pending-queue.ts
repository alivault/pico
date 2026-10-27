import type { PromptImage } from "@/lib/pico"

export type QueueLane = "steer" | "followUp"

export type PendingQueueMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: QueueLane
}

/** A row to save. A row without `pendingId` is a new prompt. */
export type PendingQueueSaveRow = {
  pendingId?: string
  text: string
  images: Array<PromptImage>
  /** The images changed: an existing prompt gets `images` in place of its own. */
  imagesChanged?: boolean
  streamingBehavior: QueueLane
}

/** One row of a queue edit session. */
export type QueueEditRow = {
  key: string
  pendingId?: string
  text: string
  originalText: string
  images: Array<PromptImage>
  originalImages: Array<PromptImage>
  lane: QueueLane
  originalLane: QueueLane
  /** The place of the row when the session started. */
  originalIndex: number
  removed: boolean
  moved: boolean
  isNew: boolean
}

export type QueueEditSession = {
  rows: Array<QueueEditRow>
  selectedKey: string
  /** The direction of the last selection change, for the caret position. */
  caret: "start" | "end"
}

/**
 * The server holds a paused queue out of the inbox. A held prompt keeps its
 * number: `pending:12` becomes `held:12`.
 */
export function queueIdentity(pendingId: string) {
  return pendingId.replace(/^(pending|held):/, "")
}

export function isHeldPendingId(pendingId: string) {
  return pendingId.startsWith("held:")
}

let newRowCounter = 0

function newRowKey() {
  newRowCounter += 1
  return `queue-new:${newRowCounter}`
}

/** Put the steering rows first and keep the order in each lane. */
export function orderQueueRows<T extends { lane: QueueLane }>(
  rows: Array<T>
): Array<T> {
  return [
    ...rows.filter((row) => row.lane === "steer"),
    ...rows.filter((row) => row.lane === "followUp"),
  ]
}

export function queueRowFromMessage(
  message: PendingQueueMessage,
  originalIndex = 0
): QueueEditRow {
  return {
    key: message.pendingId,
    pendingId: message.pendingId,
    text: message.text,
    originalText: message.text,
    images: message.images,
    originalImages: message.images,
    lane: message.streamingBehavior,
    originalLane: message.streamingBehavior,
    originalIndex,
    removed: false,
    moved: false,
    isNew: false,
  }
}

export function queueRowsFromMessages(messages: Array<PendingQueueMessage>) {
  return orderQueueRows(
    messages.map((message) => queueRowFromMessage(message))
  ).map((row, index) => ({ ...row, originalIndex: index }))
}

/** Clear the move marks when every row is back in its first place. */
function settleMoves(rows: Array<QueueEditRow>) {
  const last: Partial<Record<QueueLane, number>> = {}
  for (const row of rows) {
    if (row.isNew) continue
    if (row.lane !== row.originalLane) return rows
    if ((last[row.lane] ?? -1) > row.originalIndex) return rows
    last[row.lane] = row.originalIndex
  }
  return rows.map((row) => (row.moved ? { ...row, moved: false } : row))
}

export function areQueueRowImagesChanged(row: QueueEditRow) {
  return row.images !== row.originalImages
}

export function isQueueRowChanged(row: QueueEditRow) {
  return (
    row.isNew ||
    row.removed ||
    row.moved ||
    row.text !== row.originalText ||
    areQueueRowImagesChanged(row)
  )
}

export function hasQueueChanges(session: QueueEditSession) {
  return session.rows.some(isQueueRowChanged)
}

/** The row that the user queued last: the highest server ID, or the last row. */
export function mostRecentQueueKey(messages: Array<PendingQueueMessage>) {
  let best: { key: string; id: number } | undefined
  for (const message of messages) {
    const match = /^(?:pending|held):(\d+)$/.exec(message.pendingId)
    const id = match ? Number(match[1]) : Number.NaN
    if (Number.isFinite(id) && (!best || id > best.id)) {
      best = { key: message.pendingId, id }
    }
  }
  return best?.key ?? messages.at(-1)?.pendingId
}

export function laneRows(rows: Array<QueueEditRow>, lane: QueueLane) {
  return rows.filter((row) => row.lane === lane)
}

/**
 * Move a row one place. At the end of its lane, the row goes to the other
 * lane at the boundary: steer bottom to follow-up top, and back.
 */
export function moveQueueRow(
  rows: Array<QueueEditRow>,
  key: string,
  direction: -1 | 1
): Array<QueueEditRow> | null {
  const row = rows.find((entry) => entry.key === key)
  if (!row) return null

  const steer = laneRows(rows, "steer")
  const followUp = laneRows(rows, "followUp")
  const lane = row.lane === "steer" ? steer : followUp
  const index = lane.indexOf(row)
  const target = index + direction
  const moved = { ...row, moved: true }

  if (target >= 0 && target < lane.length) {
    const next = [...lane]
    next[index] = next[target]!
    next[target] = moved
    return settleMoves(
      row.lane === "steer" ? [...next, ...followUp] : [...steer, ...next]
    )
  }

  if (direction === -1 && row.lane === "followUp") {
    return settleMoves([
      ...steer,
      { ...moved, lane: "steer" },
      ...followUp.filter((entry) => entry !== row),
    ])
  }

  if (direction === 1 && row.lane === "steer") {
    return settleMoves([
      ...steer.filter((entry) => entry !== row),
      { ...moved, lane: "followUp" },
      ...followUp,
    ])
  }

  return null
}

/** Add a blank row above or below a row, in the same lane. */
export function insertQueueRow(
  rows: Array<QueueEditRow>,
  key: string,
  direction: -1 | 1
): { rows: Array<QueueEditRow>; key: string } | null {
  const index = rows.findIndex((entry) => entry.key === key)
  const row = rows[index]
  if (!row) return null

  const inserted: QueueEditRow = {
    key: newRowKey(),
    text: "",
    originalText: "",
    images: [],
    originalImages: [],
    lane: row.lane,
    originalLane: row.lane,
    originalIndex: 0,
    removed: false,
    moved: false,
    isNew: true,
  }
  const next = [...rows]
  next.splice(direction === -1 ? index : index + 1, 0, inserted)
  return { rows: next, key: inserted.key }
}

/** Add a blank row at the end of a lane. */
export function appendQueueRow(
  rows: Array<QueueEditRow>,
  lane: QueueLane
): { rows: Array<QueueEditRow>; key: string } {
  const inserted: QueueEditRow = {
    key: newRowKey(),
    text: "",
    originalText: "",
    images: [],
    originalImages: [],
    lane,
    originalLane: lane,
    originalIndex: 0,
    removed: false,
    moved: false,
    isNew: true,
  }
  return { rows: orderQueueRows([...rows, inserted]), key: inserted.key }
}

/**
 * Bring a session up to date with the queue: drop rows that were sent and
 * that the user did not touch, and add prompts queued since the session
 * started at the end of their lane.
 */
export function mergeQueueSession(
  session: QueueEditSession,
  messages: Array<PendingQueueMessage>
): QueueEditSession {
  const live = new Map(
    messages.map((message) => [
      queueIdentity(message.pendingId),
      message.pendingId,
    ])
  )
  const known = new Set(
    session.rows.flatMap((row) =>
      row.pendingId ? [queueIdentity(row.pendingId)] : []
    )
  )
  let renamed = false
  const kept = session.rows.flatMap((row) => {
    if (!row.pendingId) return [row]
    const pendingId = live.get(queueIdentity(row.pendingId))
    if (!pendingId) return isQueueRowChanged(row) ? [row] : []
    if (pendingId === row.pendingId) return [row]
    renamed = true
    return [{ ...row, pendingId }]
  })
  const added = messages
    .filter((message) => !known.has(queueIdentity(message.pendingId)))
    .map((message, index) =>
      queueRowFromMessage(message, session.rows.length + index)
    )

  if (!renamed && kept.length === session.rows.length && added.length === 0) {
    return session
  }

  const rows = orderQueueRows([...kept, ...added])
  let selectedKey = session.selectedKey
  if (!rows.some((row) => row.key === selectedKey)) {
    const oldIndex = session.rows.findIndex((row) => row.key === selectedKey)
    const fallback =
      kept.find((_, index) => index >= oldIndex) ?? kept.at(-1) ?? rows[0]
    selectedKey = fallback?.key ?? ""
  }

  return { ...session, rows, selectedKey }
}

/** The rows and removals to send when the user saves a session. */
export function queueSessionSavePlan(session: QueueEditSession) {
  const rows: Array<PendingQueueSaveRow> = []
  const removedPendingIds: Array<string> = []

  for (const row of session.rows) {
    const empty = !row.text.trim() && row.images.length === 0
    if (row.removed || empty) {
      if (row.pendingId) removedPendingIds.push(row.pendingId)
      continue
    }
    rows.push({
      ...(row.pendingId ? { pendingId: row.pendingId } : {}),
      text: row.text,
      images: row.images,
      ...(row.pendingId && areQueueRowImagesChanged(row)
        ? { imagesChanged: true }
        : {}),
      streamingBehavior: row.lane,
    })
  }

  return { rows, removedPendingIds }
}
