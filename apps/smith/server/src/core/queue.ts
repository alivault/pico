/**
 * Who queued each prompt of an agent, and when: for the `queue` and `unsend`
 * actions of the `agents` tool.
 *
 * Durable submissions keep no sender and no time, so Smith writes them here
 * when a prompt stays in the queue. A paused queue keeps them in its held
 * items, and a queue edit moves them to the new submissions. Without a
 * record, the sender comes from the request ID or the text of the message.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { JsonValue } from "@earendil-works/chord/json"
import {
  defineDoc,
  InboxDoc,
  type ConversationId,
  type Harness,
  type SubmissionId,
} from "@earendil-works/pi-durable"

import { messageImages, messageText } from "./items.ts"

const ctx = BACKGROUND_CONTEXT

/**
 * The sender of a queued prompt: `user` (the web client), `external` (the
 * smith CLI, MCP, or a hub), `smith` (a notice of Smith), or an agent ID.
 */
export type QueueOrigin = { from: string; at: number }

/** Origins of queued submissions, by submission ID. */
export const QueueOriginsDoc = defineDoc<{
  items: Record<string, QueueOrigin>
}>({
  kind: "smith.queue-origins",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {} }),
})

/** Keep at most this many origins: queued prompts are few. */
const MAX_ORIGINS = 200

/** Record who queued submission `submission`. */
export async function recordQueueOrigin(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  submission: SubmissionId,
  origin: QueueOrigin
) {
  await harness.commit(async (tx) => {
    const draft = await tx.doc(QueueOriginsDoc, conversationId)
    draft.items[String(submission)] = { from: origin.from, at: origin.at }
    const keys = Object.keys(draft.items)
    if (keys.length <= MAX_ORIGINS) return
    const oldest = keys
      .toSorted((a, b) => draft.items[a]!.at - draft.items[b]!.at)
      .slice(0, keys.length - MAX_ORIGINS)
    for (const key of oldest) delete draft.items[key]
  }, ctx)
}

export async function queueOrigins(
  harness: Pick<Harness, "snapshot">,
  conversationId: ConversationId
): Promise<Readonly<Record<string, QueueOrigin>>> {
  return (
    (await harness.snapshot(QueueOriginsDoc, conversationId, ctx))?.items ?? {}
  )
}

/**
 * The sender of a queued prompt without a record: an agent from the header of
 * its message, `external` for a request of the CLI, MCP, or a hub.
 */
export function inferQueueOrigin(
  requestId: string | undefined,
  text: string
): string | undefined {
  const message = /^\[Message from agent (\S+?)(?: on the hub)?\]/.exec(text)
  if (message) return message[1]
  const report = /^\[(?:Subagent|Agent) (\S+?): /.exec(text)
  if (report) return report[1]
  if (requestId?.startsWith("hub:")) return "external"
  return undefined
}

/** One prompt that waits in an agent's queue. */
export type QueuedItem = {
  /** `pending:<submission>` in the inbox, `held:<id>` in a paused queue. */
  itemId: string
  mode: "steer" | "followUp"
  text: string
  images: number
  /** See `QueueOrigin`; undefined when it is not known. */
  from?: string
  at?: number
  /** In a paused queue. */
  held: boolean
}

/** A held prompt of a paused queue, as `core/agents.ts` stores it. */
export type HeldQueueItem = {
  id: number
  mode: "steer" | "followUp"
  content: JsonValue
  requestId?: string
  from?: string
  at?: number
}

function contentText(content: unknown) {
  return messageText({ content } as never)
}

function contentImages(content: unknown) {
  return messageImages({ content } as never).length
}

/**
 * The prompts that wait in a conversation's queue, in the order of the
 * composer: the held prompts of a paused queue, then the inbox. Entry
 * writes are not prompts and are left out.
 */
export async function queuedItems(
  harness: Pick<Harness, "snapshot" | "commit">,
  conversationId: ConversationId,
  held: readonly HeldQueueItem[]
): Promise<QueuedItem[]> {
  const inbox = await harness.snapshot(InboxDoc, conversationId, ctx)
  const origins = await queueOrigins(harness, conversationId)
  const items: QueuedItem[] = held.map((item) => {
    const text = contentText(item.content)
    const from = item.from ?? inferQueueOrigin(item.requestId, text)
    return {
      itemId: `held:${item.id}`,
      mode: item.mode,
      text,
      images: contentImages(item.content),
      ...(from ? { from } : {}),
      ...(item.at ? { at: item.at } : {}),
      held: true,
    }
  })
  for (const item of inbox?.items ?? []) {
    if (item.mode === "write") continue
    const text = contentText(item.content)
    const origin = origins[String(item.id)]
    let from: string | undefined = origin?.from
    if (!from) {
      const record = await harness.commit((tx) => tx.submission(item.id), ctx)
      from = inferQueueOrigin(record?.requestId, text)
    }
    items.push({
      itemId: `pending:${item.id}`,
      mode: item.mode,
      text,
      images: contentImages(item.content),
      ...(from ? { from } : {}),
      ...(origin?.at ? { at: origin.at } : {}),
      held: false,
    })
  }
  return items
}
