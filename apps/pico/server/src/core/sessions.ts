/**
 * Sessions on durable conversations.
 *
 * A Pico session is an ownerless durable conversation with a `pico.session`
 * document: its directory, name, summary, and labels. Navigating the session
 * tree forks the conversation and the fork takes the session's place, so a
 * session is a family of conversations of which one is visible. Deleting a
 * session archives it; durable conversations are never removed.
 *
 * Every commit is observed: new entries, `pi.live`, `pi.inbox`, and `pi.agent`
 * changes become state syncs, streaming deltas, sidebar updates, and
 * completion events for the clients that watch them.
 */
import type { JsonValue } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import {
  getSupportedThinkingLevels,
  type Api,
  type ImageContent,
  type Model,
  type ModelThinkingLevel,
  type TextContent,
} from "@earendil-works/pi-ai"
import {
  AgentDoc,
  defineDoc,
  InboxDoc,
  LiveDoc,
  type AgentState,
  type CommitPublication,
  type Conversation,
  type ConversationId,
  type EntryRecord,
  type InboxItem,
  type InboxState,
  type LiveState,
  type SubmissionId,
} from "@earendil-works/pi-durable"
import { resizeImage } from "@earendil-works/pi-coding-agent"

import {
  cleanupCandidate,
  generateSessionName,
  heuristicSessionName,
} from "../extensions/auto-name.ts"
import {
  answerQuestion,
  cancelQuestions,
  pendingQuestions,
  QuestionsDoc,
  type QuestionAnswer,
  type QuestionsState,
} from "../extensions/ask.ts"
import type {
  HostCreateOptions,
  HostSessions,
  HostSessionSummary,
} from "../extensions/host.ts"
import { updateTodo, type TodoChange } from "../extensions/todo.ts"
import { JobsDoc, jobNeedingUser, type JobsState } from "../extensions/jobs.ts"
import { TimersDoc, type TimersState } from "../extensions/schedule.ts"
import { waitingLabel } from "../extensions/waiting.ts"
import {
  allProfiles,
  applyProfile,
  findProfile,
  type ToolLimits,
} from "./profiles.ts"
import { removeWorktree } from "../services/worktree.ts"
import { stateKinds, stateProviders } from "../extensions/util.ts"
import { badRequest, conflict, notFound } from "../http.ts"
import type { EventHub } from "../events.ts"
import {
  applyLiveTools,
  contextTokens,
  entryStartsItem,
  isUserInputEntry,
  detailsImage,
  itemsFromEntries,
  messageImages,
  messageText,
  streamingDelta,
  streamingItem,
  type AssistantItem,
  type ConversationItem,
  type ModelOption,
  type UsageLike,
} from "./items.ts"
import { compactionLevels } from "./compaction.ts"
import { expandPromptTemplate, expandSkillCommand } from "./resources.ts"
import type { Runtime } from "./runtime.ts"
import type { DraftSelection, Viewers } from "./viewers.ts"

const ctx = BACKGROUND_CONTEXT
const INITIAL_HISTORY_ITEMS = 100
const PREVIEW_CHARS = 160
const ALL_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

export type SessionMeta = {
  cwd: string
  name?: string
  /** `auto` names may be refined; `user` names are never replaced. */
  nameSource?: "user" | "auto"
  createdAt: number
  modifiedAt: number
  /** Archived by the user. The session stays on disk and can be restored. */
  archived?: boolean
  /** When the user archived the session. */
  archivedAt?: number
  /** Replaced by a tree navigation fork, which is the session now. */
  replacedBy?: string
  /** First conversation of the session's family. */
  family?: string
  firstMessage: string
  lastMessagePreview?: string
  lastUserMessageAt?: number
  lastMessageAt?: number
  messageCount: number
  labels?: Record<string, { label: string; timestamp: number }>
  /** The session that spawned this one with `spawn_session`. */
  parent?: string
  /** The `spawn_session` call that made this session. */
  spawnedByCall?: string
  /** How many `spawn_session` levels are above this session. */
  depth?: number
  /** Tool profile name; absent uses the default profile. */
  profile?: string
  /** Tool limits that the parent set for a child session. */
  limits?: ToolLimits
  /** The sidebar directory, when it is not `cwd` (worktree sessions). */
  group?: string
  /** The git worktree that this session made and works in. */
  worktree?: { repoRoot: string; path: string; branch: string }
}

export const SessionDoc = defineDoc<SessionMeta>({
  kind: "pico.session",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    cwd: "",
    createdAt: 0,
    modifiedAt: 0,
    firstMessage: "",
    messageCount: 0,
  }),
})

export type SessionListEntry = {
  path: string
  id: string
  cwd: string
  name?: string
  title: string
  modified: string
  lastUserMessageAt?: string
  lastMessageAt?: string
  lastMessagePreview?: string
  messageCount: number
  streaming: boolean
  unread: boolean
  parent?: string
  worktreeBranch?: string
  /** The agent waits for an answer from the user. */
  needsInput?: boolean
  /** What an idle session waits on: timers, watches, or jobs. */
  waiting?: string
}

export type PendingMessage = {
  pendingId: string
  text: string
  images: Array<{ type: "image"; mimeType: string; data: string }>
  streamingBehavior: "steer" | "followUp"
}

type Transcript = {
  entries: EntryRecord[]
  items?: ConversationItem[]
}

type Docs = {
  live?: LiveState
  inbox?: InboxState
  agent?: AgentState
}

type Dirty = {
  entries?: boolean
  live?: boolean
  inbox?: boolean
  agent?: boolean
  usage?: boolean
  /** Documents that the Agent panel shows. */
  extensions?: boolean
}

type PromptImageInput = { mimeType?: string; data?: string }

/**
 * Public session IDs are `s<conversation id>`: the client's router reads a
 * numeric search value as a number, not a session ID.
 */
export function publicId(conversationId: ConversationId) {
  return `s${conversationId}`
}

export function conversationIdOf(id: string): ConversationId {
  return Number(
    id.startsWith("s") ? id.slice(1) : id
  ) as unknown as ConversationId
}

export function sessionPath(id: string) {
  return `pico:${id}`
}

export function sessionKey(id: string) {
  return `session:${id}`
}

/** A session ID from a session ID, key, or path. */
export function parseSessionId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("pico:")) return trimmed.slice(5)
  if (trimmed.startsWith("session:")) return trimmed.slice(8)
  return trimmed
}

function iso(time: number | undefined) {
  return time ? new Date(time).toISOString() : undefined
}

function preview(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > PREVIEW_CHARS
    ? `${normalized.slice(0, PREVIEW_CHARS - 1)}…`
    : normalized
}

function fnv1a(parts: string[]) {
  let hash = 0xcbf29ce484222325n
  for (const part of parts) {
    for (const byte of Buffer.from(part)) {
      hash ^= BigInt(byte)
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
    }
  }
  return hash.toString(16).padStart(16, "0")
}

/**
 * Shrink a prompt image to the model limits (2000 px, 4.5 MB). The API refuses
 * images larger than this when a request has many images, so a large pasted
 * screenshot would break the session later.
 */
async function fitImage(image: ImageContent): Promise<ImageContent> {
  try {
    const resized = await resizeImage(
      Buffer.from(image.data, "base64"),
      image.mimeType
    )
    if (!resized?.wasResized) return image
    return { type: "image", mimeType: resized.mimeType, data: resized.data }
  } catch {
    return image
  }
}

async function userContent(
  text: string,
  images: PromptImageInput[]
): Promise<string | (TextContent | ImageContent)[]> {
  const valid = images.flatMap((image) => {
    let data = typeof image.data === "string" ? image.data.trim() : ""
    let mimeType =
      typeof image.mimeType === "string" ? image.mimeType.trim() : ""
    const match = data.match(/^data:([^;,]+);base64,(.+)$/i)
    if (match) {
      mimeType ||= match[1] ?? ""
      data = match[2] ?? ""
    }
    if (!data || !/^image\//i.test(mimeType)) return []
    return [{ type: "image" as const, mimeType, data }]
  })
  if (valid.length === 0) return text
  const fitted = await Promise.all(valid.map(fitImage))
  return [...(text ? [{ type: "text" as const, text }] : []), ...fitted]
}

function pendingMessageOf(
  pendingId: string,
  mode: "steer" | "followUp",
  content: unknown
): PendingMessage {
  const message = { content }
  return {
    pendingId,
    text: messageText(message as never),
    images: messageImages(message as never).map(({ mimeType, data }) => ({
      type: "image",
      mimeType,
      data,
    })),
    streamingBehavior: mode,
  }
}

function inboxMessage(item: InboxItem): PendingMessage | undefined {
  if (item.mode === "write") return undefined
  return pendingMessageOf(`pending:${item.id}`, item.mode, item.content)
}

/** A queued prompt that Pico holds out of the inbox while the queue is paused. */
type HeldItem = {
  id: number
  mode: "steer" | "followUp"
  content: JsonValue
  /** A follow-up from another session: it is held only one time. */
  requestId?: string
}

/**
 * The paused queue. An abort, or an open queue edit, moves the queued prompts
 * here, so the agent does not get them. Resume submits them again.
 */
export const HeldQueueDoc = defineDoc<{ items: HeldItem[] }>({
  kind: "pico.queue",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [] }),
})

function heldMessage(item: HeldItem): PendingMessage {
  return pendingMessageOf(`held:${item.id}`, item.mode, item.content)
}

/** Steering prompts first: a resumed queue starts with a steer, like Pi. */
function heldInDeliveryOrder(items: HeldItem[]) {
  return [
    ...items.filter((item) => item.mode === "steer"),
    ...items.filter((item) => item.mode !== "steer"),
  ]
}

/**
 * One row of a queue edit: an existing prompt (`pendingId`) or a new one.
 * `images` replaces the images of an existing prompt.
 */
export type PendingEdit = {
  pendingId?: string
  text?: string
  images?: PromptImageInput[]
  streamingBehavior?: "steer" | "followUp"
}

/** Put new text in queued content and keep its images. */
function replaceContentText(content: unknown, text: string) {
  if (!Array.isArray(content)) return text
  const rest = (content as Array<{ type?: string }>).filter(
    (part) => part?.type !== "text"
  )
  if (rest.length === 0) return text
  return [...(text ? [{ type: "text" as const, text }] : []), ...rest]
}

/** The content of a queued prompt after an edit of its text or images. */
async function editedContent(content: JsonValue, edit: PendingEdit) {
  if (edit.images) {
    const text = edit.text ?? messageText({ content } as never)
    return (await userContent(text, edit.images)) as JsonValue
  }
  if (edit.text === undefined) return content
  return replaceContentText(content, edit.text) as JsonValue
}

function contentIsEmpty(content: unknown) {
  if (typeof content === "string") return !content.trim()
  if (!Array.isArray(content)) return true
  return !(content as Array<{ type?: string; text?: string }>).some(
    (part) => part?.type !== "text" || Boolean(part.text?.trim())
  )
}

function submissionIdFromPending(pendingId: string): SubmissionId {
  const raw = pendingId.startsWith("pending:") ? pendingId.slice(8) : pendingId
  const id = Number(raw)
  if (!Number.isFinite(id)) throw badRequest("Unknown pending prompt")
  return id as unknown as SubmissionId
}

export class Sessions implements HostSessions {
  readonly #runtime: Runtime
  readonly #hub: EventHub
  readonly #viewers: Viewers
  readonly #metas = new Map<string, SessionMeta>()
  readonly #docs = new Map<string, Docs>()
  readonly #transcripts = new Map<string, Transcript>()
  readonly #loading = new Map<string, Promise<Transcript>>()
  readonly #arrivals = new Map<string, EntryRecord[]>()
  readonly #watchers = new Map<string, number>()
  readonly #streaming = new Map<string, AssistantItem | undefined>()
  readonly #busy = new Map<string, boolean>()
  readonly #compacting = new Map<string, boolean>()
  readonly #dirty = new Map<string, Dirty>()
  readonly #metaWrites = new Map<string, NodeJS.Timeout>()
  readonly #naming = new Set<string>()
  /** Sessions whose agent waits for the user. */
  readonly #needsInput = new Set<string>()
  /** Sessions with an open `ask_user` question. */
  readonly #questionWaits = new Set<string>()
  /** Sessions with a job that needs the user (see `jobNeedingUser`). */
  readonly #jobWaits = new Map<
    string,
    { jobId: string; name: string; prompt: string }
  >()
  /** The timers and jobs of each session, for `#waiting`. */
  readonly #waitSources = new Map<
    string,
    { timers?: TimersState; jobs?: JobsState }
  >()
  /** What each session waits on (see `waitingLabel`). */
  readonly #waiting = new Map<string, string>()
  readonly #held = new Map<string, HeldItem[]>()
  #stateKinds: Set<string> | undefined
  #flushScheduled = false
  #sessionsTimer: NodeJS.Timeout | undefined

  constructor(runtime: Runtime, hub: EventHub, viewers: Viewers) {
    this.#runtime = runtime
    this.#hub = hub
    this.#viewers = viewers
    // Read state is global: tell every tab and client about a change.
    viewers.onReadChange((id, unread) => {
      if (!this.#metas.has(id)) return
      this.#hub.push({
        type: "session_status",
        sessionId: id,
        sessionKey: sessionKey(id),
        sessionPath: sessionPath(id),
        streaming: this.isBusy(id),
        unread,
      })
      this.#scheduleSessionsBroadcast()
    })
  }

  get #harness() {
    return this.#runtime.harness
  }

  /** Read every session and start observing commits. */
  async load() {
    let cursor: Parameters<Conversation["entries"]>[2]
    const ids: ConversationId[] = []
    do {
      const page = await this.#harness.commit(
        (tx) => tx.scanConversations({}, 500, cursor),
        ctx
      )
      for (const record of page.items) if (!record.owner) ids.push(record.id)
      cursor = page.next
    } while (cursor)

    await Promise.all(
      ids.map(async (conversationId) => {
        const meta = await this.#harness.snapshot(
          SessionDoc,
          conversationId,
          ctx
        )
        if (!meta || !meta.cwd) return
        const id = publicId(conversationId)
        this.#metas.set(id, { ...meta })
        const live = await this.#harness.snapshot(LiveDoc, conversationId, ctx)
        this.#docs.set(id, live ? { live: live as LiveState } : {})
        this.#busy.set(id, live?.run !== undefined)
        const questions = await this.#harness.snapshot(
          QuestionsDoc,
          conversationId,
          ctx
        )
        if (pendingQuestions(questions as QuestionsState | undefined).length) {
          this.#questionWaits.add(id)
          this.#needsInput.add(id)
        }
        const [timers, jobs] = await Promise.all([
          this.#harness.snapshot(TimersDoc, conversationId, ctx),
          this.#harness.snapshot(JobsDoc, conversationId, ctx),
        ])
        this.#waitSources.set(id, {
          ...(timers ? { timers } : {}),
          ...(jobs ? { jobs } : {}),
        })
        const waiting = waitingLabel(timers, jobs)
        if (waiting) this.#waiting.set(id, waiting)
      })
    )
    this.#harness.subscribeCommits((publication) => this.#observe(publication))
    // Continue runs an earlier process left unfinished.
    this.#harness.resume()
  }

  // ---------------------------------------------------------------------------
  // Lookup

  has(id: string | undefined): id is string {
    return id !== undefined && this.#metas.has(id)
  }

  meta(id: string): SessionMeta {
    const meta = this.#metas.get(id)
    if (!meta) throw notFound(`Unknown session: ${id}`)
    return meta
  }

  /** The visible session for an ID, following tree navigation replacements. */
  current(id: string | undefined): string | undefined {
    let current = parseSessionId(id)
    for (let hops = 0; current && hops < 100; hops += 1) {
      const meta = this.#metas.get(current)
      if (!meta) return undefined
      if (!meta.replacedBy) return current
      current = meta.replacedBy
    }
    return current
  }

  isVisible(id: string) {
    const meta = this.#metas.get(id)
    return Boolean(meta && !meta.archived && !meta.replacedBy)
  }

  isBusy(id: string) {
    return this.#busy.get(id) === true
  }

  async conversation(id: string): Promise<Conversation> {
    const conversation = await this.#harness.conversation(
      conversationIdOf(id),
      ctx
    )
    if (!conversation || !this.#metas.has(id))
      throw notFound(`Unknown session: ${id}`)
    return conversation
  }

  activeRunCount() {
    let count = 0
    for (const busy of this.#busy.values()) if (busy) count += 1
    return count
  }

  // ---------------------------------------------------------------------------
  // Watching

  /** An event stream shows this session; keep its transcript and send its updates. */
  watch(id: string) {
    this.#watchers.set(id, (this.#watchers.get(id) ?? 0) + 1)
    return () => {
      const count = (this.#watchers.get(id) ?? 1) - 1
      if (count <= 0) this.#watchers.delete(id)
      else this.#watchers.set(id, count)
    }
  }

  #watched(id: string) {
    return (this.#watchers.get(id) ?? 0) > 0
  }

  // ---------------------------------------------------------------------------
  // Transcripts and documents

  async transcript(id: string): Promise<Transcript> {
    const loaded = this.#transcripts.get(id)
    if (loaded) return loaded
    let loading = this.#loading.get(id)
    if (!loading) {
      loading = this.#loadTranscript(id)
      this.#loading.set(id, loading)
    }
    return loading
  }

  async #loadTranscript(id: string): Promise<Transcript> {
    this.#arrivals.set(id, [])
    try {
      const conversation = await this.conversation(id)
      const entries: EntryRecord[] = []
      let cursor: Parameters<Conversation["entries"]>[2]
      do {
        const page = await conversation.entries(
          { order: "ascending" },
          1000,
          cursor,
          ctx
        )
        entries.push(...page.items)
        cursor = page.next
      } while (cursor)
      const last = entries.at(-1)?.id ?? -1
      for (const entry of this.#arrivals.get(id) ?? []) {
        if ((entry.id as unknown as number) > (last as unknown as number))
          entries.push(entry)
      }
      const transcript: Transcript = { entries }
      this.#transcripts.set(id, transcript)
      this.#evictTranscripts()
      return transcript
    } finally {
      this.#arrivals.delete(id)
      this.#loading.delete(id)
    }
  }

  /** Free memory under pressure: drop transcripts that no client watches. */
  dropUnwatchedTranscripts() {
    let dropped = 0
    for (const id of this.#transcripts.keys()) {
      if (this.#watched(id) || this.isBusy(id)) continue
      this.#transcripts.delete(id)
      dropped += 1
    }
    return dropped
  }

  #evictTranscripts() {
    if (this.#transcripts.size <= 24) return
    for (const id of this.#transcripts.keys()) {
      if (this.#transcripts.size <= 24) break
      if (this.#watched(id) || this.isBusy(id)) continue
      this.#transcripts.delete(id)
    }
  }

  async #doc<K extends keyof Docs>(id: string, key: K): Promise<Docs[K]> {
    const docs = this.#docs.get(id) ?? {}
    this.#docs.set(id, docs)
    if (key in docs) return docs[key]
    const conversationId = conversationIdOf(id)
    const token =
      key === "live" ? LiveDoc : key === "inbox" ? InboxDoc : AgentDoc
    const value = (await this.#harness.snapshot(
      token as typeof LiveDoc,
      conversationId,
      ctx
    )) as Docs[K]
    if (!(key in docs)) docs[key] = value
    return docs[key]
  }

  // ---------------------------------------------------------------------------
  // Observation

  #observe(publication: CommitPublication) {
    for (const change of publication.changes) {
      if (change.type === "entry") {
        const entry = change.value
        const id = publicId(entry.conversationId)
        if (!this.#metas.has(id)) continue
        const transcript = this.#transcripts.get(id)
        if (transcript) {
          transcript.entries.push(entry)
          delete transcript.items
        } else {
          this.#arrivals.get(id)?.push(entry)
        }
        this.#noteEntry(id, entry)
        this.#markDirty(id, { entries: true })
      } else if (change.type === "document") {
        if (
          change.conversationId === undefined &&
          this.#isStateKind(change.record.kind)
        ) {
          // A session-wide document: every session may show it.
          this.#hub.push({
            type: "session_extensions",
            sessionId: "*",
            kind: change.record.kind,
          })
          continue
        }
        const id =
          change.conversationId === undefined
            ? undefined
            : publicId(change.conversationId)
        if (!id || !this.#metas.has(id)) continue
        const kind = change.record.kind
        const docs = this.#docs.get(id) ?? {}
        this.#docs.set(id, docs)
        const value = change.value ?? undefined
        if (kind === "pi.live") {
          docs.live = value as LiveState | undefined
          this.#noteRunningTools(id, docs.live)
          this.#markDirty(id, { live: true })
        } else if (kind === "pi.inbox") {
          docs.inbox = value as InboxState | undefined
          this.#markDirty(id, { inbox: true })
        } else if (kind === "pi.agent") {
          docs.agent = value as AgentState | undefined
          this.#markDirty(id, { agent: true })
        } else if (kind === "pi.usage") {
          this.#markDirty(id, { usage: true })
        } else if (this.#isStateKind(kind)) {
          if (kind === "pico.questions") {
            if (pendingQuestions(value as QuestionsState | undefined).length)
              this.#questionWaits.add(id)
            else this.#questionWaits.delete(id)
            this.#updateNeedsInput(id)
          } else if (kind === "pico.jobs") {
            const job = jobNeedingUser(value as JobsState | undefined)
            if (job) this.#jobWaits.set(id, job)
            else this.#jobWaits.delete(id)
            this.#updateNeedsInput(id)
            this.#updateWaiting(id, { jobs: value as JobsState | undefined })
          } else if (kind === "pico.timers") {
            this.#updateWaiting(id, {
              timers: value as TimersState | undefined,
            })
          }
          this.#markDirty(id, { extensions: true })
        }
      }
    }
  }

  readonly #runningTools = new Map<
    string,
    Map<string, { name: string; startedAt: number }>
  >()

  /** Note when each tool call of the current round started to run. */
  #noteRunningTools(id: string, live: LiveState | undefined) {
    const before = this.#runningTools.get(id)
    const next = new Map<string, { name: string; startedAt: number }>()
    for (const slot of live?.tools ?? []) {
      if (slot.status !== "running") continue
      next.set(
        slot.callId,
        before?.get(slot.callId) ?? { name: slot.name, startedAt: Date.now() }
      )
    }
    if (next.size > 0) this.#runningTools.set(id, next)
    else this.#runningTools.delete(id)
  }

  /** The tool calls that run now in a session, oldest first. */
  runningTools(id: string) {
    return [...(this.#runningTools.get(id) ?? new Map()).entries()]
      .map(([callId, value]) => ({ callId, ...value }))
      .sort((left, right) => left.startedAt - right.startedAt)
  }

  /** Keep the sidebar summary current as entries arrive. */
  #noteEntry(id: string, entry: EntryRecord) {
    if (!entryStartsItem(entry) || entry.kind === "pi.compaction") return
    const meta = this.#metas.get(id)
    if (!meta) return
    const message = entry.model?.[0] as { timestamp?: number } | undefined
    const time =
      typeof message?.timestamp === "number" ? message.timestamp : Date.now()
    const text = messageText(message as never)
    const change: Partial<SessionMeta> = {
      messageCount: meta.messageCount + 1,
      lastMessageAt: time,
      modifiedAt: Date.now(),
    }
    if (isUserInputEntry(entry)) {
      change.lastUserMessageAt = time
      if (!meta.firstMessage) change.firstMessage = preview(text) || "Image"
    }
    if (text.trim()) change.lastMessagePreview = preview(text)
    this.#updateMeta(id, change, { persistAfterMs: 1500 })
  }

  #isStateKind(kind: string) {
    this.#stateKinds ??= stateKinds()
    return this.#stateKinds.has(kind)
  }

  /** Tell clients to read a session's Agent panel state again. */
  extensionStateChanged(id: string, kind: string) {
    this.#hub.push(
      { type: "session_extensions", sessionId: id, ...(kind ? { kind } : {}) },
      { sessionId: id }
    )
  }

  /** The state that the Agent panel shows, one value for each provider. */
  async extensionState(id: string) {
    this.meta(id)
    const conversationId = conversationIdOf(id)
    const state: Record<string, unknown> = {}
    for (const provider of stateProviders()) {
      try {
        const value = await provider.read(this.#harness, conversationId, ctx)
        if (value !== undefined) state[provider.key] = value
      } catch (error) {
        console.warn(`[pico] could not read ${provider.key} state:`, error)
      }
    }
    const children = this.list({ parent: id })
    if (children.length > 0) state.children = children
    const meta = this.meta(id)
    const instructions = await this.instructionFiles(id).catch(
      (error: unknown) => {
        console.warn("[pico] could not read the instruction files:", error)
        return []
      }
    )
    if (instructions.length > 0)
      state.instructions = { cwd: meta.cwd, files: instructions }
    state.profile = meta.profile ?? "full"
    if (meta.parent || meta.worktree) {
      state.session = {
        ...(meta.parent && this.#metas.has(meta.parent)
          ? { parent: { id: meta.parent, title: this.#title(meta.parent) } }
          : {}),
        ...(meta.worktree ? { worktree: meta.worktree } : {}),
      }
    }
    return state
  }

  /** The context files (AGENTS.md) that the agent of a session loads. */
  async instructionFiles(id: string) {
    const files = (await this.#runtime.resources.get(this.meta(id).cwd))
      .agentsFiles
    return files.map(({ path }) => ({ path }))
  }

  /** The content of one context file that the agent of a session loads. */
  async instructionFile(id: string, path: string) {
    const files = (await this.#runtime.resources.get(this.meta(id).cwd))
      .agentsFiles
    return files.find((file) => file.path === path)?.content
  }

  /** Questions and jobs that need the user make a session need input. */
  #updateNeedsInput(id: string) {
    this.setNeedsInput(
      id,
      this.#questionWaits.has(id) || this.#jobWaits.has(id),
      this.#questionWaits.has(id) ? undefined : this.#jobWaits.get(id)
    )
  }

  /**
   * Mark that the agent of a session waits, or no longer waits, for the
   * user. `job` names a job that needs the user, for the notification.
   */
  setNeedsInput(
    id: string,
    waiting: boolean,
    job?: { jobId: string; name: string; prompt: string }
  ) {
    if (!this.#metas.has(id)) return
    if (waiting === this.#needsInput.has(id)) return
    if (waiting) this.#needsInput.add(id)
    else this.#needsInput.delete(id)
    this.#scheduleSessionsBroadcast()
    this.#hub.push(
      {
        type: "session_status",
        sessionId: id,
        sessionKey: sessionKey(id),
        sessionPath: sessionPath(id),
        streaming: this.isBusy(id),
        needsInput: waiting,
        ...(waiting && job
          ? {
              reason: "job",
              jobId: job.jobId,
              jobName: job.name,
              prompt: job.prompt,
            }
          : {}),
      },
      { sessionId: id }
    )
    void this.publishStateIfWatched(id)
  }

  needsInput(id: string) {
    return this.#needsInput.has(id)
  }

  /** What a session waits on: timers, watches, or jobs. */
  waiting(id: string) {
    return this.#waiting.get(id)
  }

  /** Keep `#waiting` current when the timers or jobs of a session change. */
  #updateWaiting(
    id: string,
    change: { timers?: TimersState; jobs?: JobsState }
  ) {
    const sources = { ...this.#waitSources.get(id), ...change }
    this.#waitSources.set(id, sources)
    const waiting = waitingLabel(sources.timers, sources.jobs)
    if (waiting === this.#waiting.get(id)) return
    if (waiting) this.#waiting.set(id, waiting)
    else this.#waiting.delete(id)
    this.#scheduleSessionsBroadcast()
    this.#hub.push(
      {
        type: "session_status",
        sessionId: id,
        sessionKey: sessionKey(id),
        sessionPath: sessionPath(id),
        streaming: this.isBusy(id),
        // An empty string tells clients that it waits on nothing.
        waiting: waiting ?? "",
      },
      { sessionId: id }
    )
  }

  list(filter: { parent?: string; directory?: string }): HostSessionSummary[] {
    return [...this.#metas.entries()]
      .filter(
        ([id, meta]) =>
          this.isVisible(id) &&
          (filter.parent === undefined || meta.parent === filter.parent) &&
          (filter.directory === undefined ||
            (meta.group ?? meta.cwd) === filter.directory ||
            meta.cwd === filter.directory)
      )
      .sort((left, right) => activity(right[1]) - activity(left[1]))
      .map(([id, meta]) => ({
        id,
        title: this.#title(id),
        cwd: meta.cwd,
        busy: this.isBusy(id),
        needsInput: this.#needsInput.has(id),
        ...(this.#waiting.has(id) ? { waiting: this.#waiting.get(id) } : {}),
        unread: this.#viewers.isUnread(id),
        ...(meta.parent ? { parent: meta.parent } : {}),
        ...(meta.worktree ? { worktreeBranch: meta.worktree.branch } : {}),
        messageCount: meta.messageCount,
        ...(meta.lastMessagePreview
          ? { lastMessagePreview: meta.lastMessagePreview }
          : {}),
        ...(meta.lastMessageAt ? { lastMessageAt: meta.lastMessageAt } : {}),
      }))
  }

  /** Visible sessions that `spawn_session` made for a session, oldest first. */
  children(id: string): string[] {
    return [...this.#metas.entries()]
      .filter(
        ([childId, meta]) => meta.parent === id && this.isVisible(childId)
      )
      .sort((left, right) => left[1].createdAt - right[1].createdAt)
      .map(([childId]) => childId)
  }

  #markDirty(id: string, dirty: Dirty) {
    const current = this.#dirty.get(id) ?? {}
    this.#dirty.set(id, { ...current, ...dirty })
    if (this.#flushScheduled) return
    this.#flushScheduled = true
    setImmediate(() => {
      this.#flushScheduled = false
      void this.#flush()
    })
  }

  async #flush() {
    const dirty = [...this.#dirty.entries()]
    this.#dirty.clear()
    for (const [id, changes] of dirty) {
      try {
        await this.#flushSession(id, changes)
      } catch (error) {
        console.error(`[pico] could not publish session ${id}:`, error)
      }
    }
  }

  async #flushSession(id: string, changes: Dirty) {
    const docs = this.#docs.get(id) ?? {}
    const busy = docs.live?.run !== undefined
    const wasBusy = this.#busy.get(id) === true
    const compacting = (docs.live?.compactions?.length ?? 0) > 0
    const wasCompacting = this.#compacting.get(id) === true
    this.#busy.set(id, busy)
    this.#compacting.set(id, compacting)

    if (busy !== wasBusy) {
      const parent = this.#metas.get(id)?.parent
      if (parent && this.#metas.has(parent))
        this.extensionStateChanged(parent, "children")
      this.#hub.push(
        {
          type: "session_status",
          sessionId: id,
          sessionKey: sessionKey(id),
          sessionPath: sessionPath(id),
          streaming: busy,
        },
        { sessionId: id }
      )
      this.#scheduleSessionsBroadcast()
    }
    if ((wasBusy && !busy) || (wasCompacting && !compacting && !busy)) {
      await this.#finished(id, wasBusy && !busy ? "agent" : "manual_compaction")
    }
    if (changes.entries) this.#scheduleSessionsBroadcast()
    if (changes.extensions) this.extensionStateChanged(id, "")

    if (!this.#watched(id)) return
    const structural =
      changes.entries ||
      changes.inbox ||
      changes.agent ||
      changes.usage ||
      busy !== wasBusy ||
      compacting !== wasCompacting
    const toolsChanged = changes.live && this.#toolsSignature(id, docs.live)
    if (structural || toolsChanged) {
      await this.publishState(id)
      return
    }
    if (changes.live) {
      const next = streamingItem(docs.live)
      const previous = this.#streaming.get(id)
      if (!next) {
        if (previous) await this.publishState(id)
        return
      }
      const operations = streamingDelta(previous, next)
      this.#streaming.set(id, next)
      if (operations.length === 0) return
      this.#hub.push(
        { type: "conversation_delta", sessionId: id, operations },
        { sessionId: id }
      )
    }
  }

  readonly #toolSignatures = new Map<string, string>()

  /** Whether the running output of the current tool round changed. */
  #toolsSignature(id: string, live: LiveState | undefined) {
    const signature = JSON.stringify(
      (live?.tools ?? []).map((slot) => [
        slot.callId,
        slot.status,
        slot.output?.length ?? 0,
        slot.details === undefined ? 0 : 1,
        slot.entry ?? 0,
      ])
    )
    const changed = this.#toolSignatures.get(id) !== signature
    this.#toolSignatures.set(id, signature)
    return changed
  }

  async #finished(id: string, reason: "agent" | "manual_compaction") {
    this.#viewers.markDone(id)
    const meta = this.#metas.get(id)
    const transcript = this.#transcripts.get(id)
    const lastAssistant = transcript?.entries.findLast(
      (entry) => entry.kind === "pi.assistant"
    )
    const stopReason = (
      lastAssistant?.model?.[0] as { stopReason?: string } | undefined
    )?.stopReason
    this.#persistMetaNow(id)
    this.#hub.push(
      {
        type: "session_done",
        id: `done:${id}:${this.#hub.currentSequence + 1}`,
        sessionId: id,
        sessionKey: sessionKey(id),
        sessionPath: sessionPath(id),
        cwd: meta?.cwd,
        title: this.#title(id),
        reason,
        outcome: stopReason === "error" ? "error" : "success",
        completedAt: new Date().toISOString(),
        // The agent goes on when its timer, watch, or job fires.
        ...(this.#waiting.has(id) ? { waiting: this.#waiting.get(id) } : {}),
      },
      { sessionId: id }
    )
    this.#scheduleSessionsBroadcast()
  }

  #scheduleSessionsBroadcast() {
    if (this.#sessionsTimer) return
    this.#sessionsTimer = setTimeout(() => {
      this.#sessionsTimer = undefined
      this.#hub.push(this.sessionsPayload({ unread: this.#viewers.unread() }))
    }, 200)
  }

  // ---------------------------------------------------------------------------
  // Metadata

  #updateMeta(
    id: string,
    change: Partial<SessionMeta>,
    options: { persistAfterMs?: number } = {}
  ) {
    const meta = this.#metas.get(id)
    if (!meta) return
    const next: SessionMeta = { ...meta, ...change }
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key]
    }
    this.#metas.set(id, next)
    const delay = options.persistAfterMs ?? 0
    const pending = this.#metaWrites.get(id)
    if (pending) clearTimeout(pending)
    const timer = setTimeout(() => {
      this.#metaWrites.delete(id)
      void this.#writeMeta(id)
    }, delay)
    this.#metaWrites.set(id, timer)
  }

  #persistMetaNow(id: string) {
    const pending = this.#metaWrites.get(id)
    if (!pending) return
    clearTimeout(pending)
    this.#metaWrites.delete(id)
    void this.#writeMeta(id)
  }

  async #writeMeta(id: string) {
    const meta = this.#metas.get(id)
    if (!meta) return
    const conversationId = conversationIdOf(id)
    try {
      await this.#harness.commit(async (tx) => {
        const draft = (await tx.doc(
          SessionDoc,
          conversationId
        )) as unknown as Record<string, unknown>
        for (const key of Object.keys(draft)) {
          if (!(key in meta)) delete draft[key]
        }
        Object.assign(draft, JSON.parse(JSON.stringify(meta)))
      }, ctx)
    } catch (error) {
      console.error(`[pico] could not save session ${id}:`, error)
    }
  }

  /** Save every pending metadata change, for shutdown. */
  async flushMeta() {
    const ids = [...this.#metaWrites.keys()]
    for (const id of ids) {
      clearTimeout(this.#metaWrites.get(id))
      this.#metaWrites.delete(id)
    }
    await Promise.all(ids.map((id) => this.#writeMeta(id)))
  }

  #title(id: string) {
    const meta = this.#metas.get(id)
    return meta?.name?.trim() || meta?.firstMessage?.trim() || "New session"
  }

  // ---------------------------------------------------------------------------
  // Lists

  summary(id: string, unread: Set<string>): SessionListEntry {
    const meta = this.meta(id)
    return {
      path: sessionPath(id),
      id,
      cwd: meta.cwd,
      ...(meta.name ? { name: meta.name } : {}),
      title: this.#title(id),
      modified: iso(meta.modifiedAt) ?? new Date(0).toISOString(),
      ...(meta.lastUserMessageAt
        ? { lastUserMessageAt: iso(meta.lastUserMessageAt) }
        : {}),
      ...(meta.lastMessageAt ? { lastMessageAt: iso(meta.lastMessageAt) } : {}),
      ...(meta.lastMessagePreview
        ? { lastMessagePreview: meta.lastMessagePreview }
        : {}),
      messageCount: meta.messageCount,
      streaming: this.isBusy(id),
      unread: unread.has(id),
      ...(meta.parent ? { parent: meta.parent } : {}),
      ...(meta.worktree ? { worktreeBranch: meta.worktree.branch } : {}),
      ...(this.#needsInput.has(id) ? { needsInput: true } : {}),
      ...(this.#waiting.has(id) ? { waiting: this.#waiting.get(id) } : {}),
    }
  }

  /** The sidebar directory of a session. */
  directoryOf(id: string) {
    const meta = this.meta(id)
    return meta.group ?? meta.cwd
  }

  /** Visible sessions of a directory, most recently active first. */
  directorySessions(directory: string): string[] {
    return [...this.#metas.entries()]
      .filter(
        ([id, meta]) =>
          (meta.group ?? meta.cwd) === directory && this.isVisible(id)
      )
      .sort((left, right) => activity(right[1]) - activity(left[1]))
      .map(([id]) => id)
  }

  directories(): string[] {
    const directories = new Set<string>()
    for (const [id, meta] of this.#metas)
      if (this.isVisible(id)) directories.add(meta.group ?? meta.cwd)
    return [...directories].sort()
  }

  #revision(directory: string, ids: string[], unread: Set<string>) {
    return fnv1a([
      directory,
      ...ids.flatMap((id) => {
        const meta = this.#metas.get(id)!
        return [
          id,
          String(meta.modifiedAt),
          meta.name ?? "",
          String(meta.messageCount),
          this.isBusy(id) ? "1" : "0",
          unread.has(id) ? "1" : "0",
          this.#needsInput.has(id) ? "1" : "0",
          this.#waiting.get(id) ?? "",
        ]
      }),
    ])
  }

  directoryIndex(directory: string, unread: Set<string>) {
    const ids = this.directorySessions(directory)
    return {
      directory,
      totalCount: ids.length,
      revision: this.#revision(directory, ids, unread),
      sessions: ids.map((id) => this.summary(id, unread)),
    }
  }

  sessionsPayload(options: {
    activeSessionId?: string
    directories?: string[]
    unread?: Set<string>
  }) {
    const unread = options.unread ?? new Set<string>()
    const directories = this.directories()
    const indexDirectories = new Set(options.directories ?? [])
    if (options.activeSessionId && this.#metas.has(options.activeSessionId)) {
      indexDirectories.add(this.directoryOf(options.activeSessionId))
    }
    const directoryIndexes: Record<
      string,
      ReturnType<Sessions["directoryIndex"]>
    > = {}
    for (const directory of indexDirectories)
      directoryIndexes[directory] = this.directoryIndex(directory, unread)
    return {
      type: "sessions",
      directories,
      directoryStates: directories.map((path) => {
        const ids = this.directorySessions(path)
        return {
          path,
          totalCount: ids.length,
          revision: this.#revision(path, ids, unread),
        }
      }),
      directoryIndexes,
      ...(options.activeSessionId && this.#metas.has(options.activeSessionId)
        ? {
            activeSessionPath: sessionPath(options.activeSessionId),
            activeSessionId: options.activeSessionId,
            activeSessionKey: sessionKey(options.activeSessionId),
          }
        : {}),
    }
  }

  // ---------------------------------------------------------------------------
  // Models

  availableModels(): ModelOption[] {
    return this.#runtime.models.getAvailableSnapshot().map((model) => ({
      id: model.id,
      provider: model.provider,
      name: model.name,
      reasoning: model.reasoning,
    }))
  }

  defaultModel(): { provider: string; modelId: string } | undefined {
    const settings = this.#runtime.piSettings()
    const available = this.#runtime.models.getAvailableSnapshot()
    const provider = settings.getDefaultProvider()
    const modelId = settings.getDefaultModel()
    const preferred = available.find(
      (model) => model.provider === provider && model.id === modelId
    )
    const fallback =
      preferred ??
      available.find((model) => model.provider === provider) ??
      available[0]
    return fallback
      ? { provider: fallback.provider, modelId: fallback.id }
      : undefined
  }

  defaultThinkingLevel(): ModelThinkingLevel {
    const level = this.#runtime.piSettings().getDefaultThinkingLevel()
    return (level as ModelThinkingLevel | undefined) ?? "medium"
  }

  #model(
    ref: { provider: string; modelId: string } | undefined
  ): Model<Api> | undefined {
    return ref
      ? this.#runtime.models.getModel(ref.provider, ref.modelId)
      : undefined
  }

  #modelOption(
    ref: { provider: string; modelId: string } | undefined
  ): ModelOption | undefined {
    if (!ref) return undefined
    const model = this.#model(ref)
    return {
      id: ref.modelId,
      provider: ref.provider,
      ...(model ? { name: model.name, reasoning: model.reasoning } : {}),
    }
  }

  thinkingLevels(
    ref: { provider: string; modelId: string } | undefined
  ): string[] {
    const model = this.#model(ref)
    if (!model) return ALL_THINKING_LEVELS.filter((level) => level !== "max")
    return getSupportedThinkingLevels(model)
  }

  validateThinkingLevel(level: string) {
    if (!ALL_THINKING_LEVELS.includes(level as ModelThinkingLevel)) {
      throw badRequest(`Invalid thinking level: ${level}`)
    }
    return level as ModelThinkingLevel
  }

  // ---------------------------------------------------------------------------
  // State sync

  async #skills(cwd: string) {
    try {
      const skills = (await this.#runtime.resources.get(cwd)).skills
      return skills.map((skill) => ({
        name: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        ...(skill.sourceInfo?.scope
          ? { scope: String(skill.sourceInfo.scope) }
          : {}),
        ...(skill.sourceInfo?.source
          ? { source: skill.sourceInfo.source }
          : {}),
      }))
    } catch {
      return []
    }
  }

  #contextUsage(
    entries: readonly EntryRecord[],
    ref: { provider: string; modelId: string } | undefined
  ) {
    const model = this.#model(ref)
    const contextWindow = model?.contextWindow
    let tokens: number | null = null
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!
      if (entry.kind === "pi.compaction" || entry.kind === "pi.reset") break
      if (entry.kind !== "pi.assistant") continue
      const usage = (entry.model?.[0] as { usage?: UsageLike } | undefined)
        ?.usage
      const value = contextTokens(usage)
      if (value) {
        tokens = value
        break
      }
    }
    if (!contextWindow)
      return tokens === null ? undefined : { tokens, percent: null }
    const levels =
      ref &&
      compactionLevels(this.#runtime.compactionPolicy(ref), contextWindow)
    return {
      tokens,
      contextWindow,
      ...levels,
      percent:
        tokens === null ? null : Math.min(100, (tokens / contextWindow) * 100),
    }
  }

  /** Items with the current tool round and the in-flight answer applied. */
  async items(id: string) {
    const transcript = await this.transcript(id)
    transcript.items ??= itemsFromEntries(transcript.entries, id)
    const live = await this.#doc(id, "live")
    const busy = live?.run !== undefined
    const withTools = applyLiveTools(transcript.items, live, busy)
    const streaming = streamingItem(live)
    this.#streaming.set(id, streaming)
    return { committed: withTools, streaming }
  }

  async stateSync(id: string, options: { editorText?: string } = {}) {
    const meta = this.meta(id)
    const transcript = await this.transcript(id)
    const { committed, streaming } = await this.items(id)
    const live = await this.#doc(id, "live")
    const inbox = await this.#doc(id, "inbox")
    const agent = await this.#doc(id, "agent")
    const busy = live?.run !== undefined
    const offset = Math.max(0, committed.length - INITIAL_HISTORY_ITEMS)
    const items = committed.slice(offset)
    if (streaming) items.push(streaming)
    const modelRef = agent?.model ?? this.defaultModel()
    return {
      type: "state_sync",
      sessionKey: sessionKey(id),
      sessionId: id,
      sessionFile: sessionPath(id),
      ...(meta.name ? { sessionName: meta.name } : {}),
      ...(meta.parent && this.#metas.has(meta.parent)
        ? {
            parentSession: { id: meta.parent, title: this.#title(meta.parent) },
          }
        : {}),
      ...(meta.worktree ? { worktree: meta.worktree } : {}),
      firstMessage: meta.firstMessage,
      cwd: meta.cwd,
      directory: meta.group ?? meta.cwd,
      modified: iso(meta.modifiedAt),
      draft: false,
      streaming: busy,
      compacting: (live?.compactions?.length ?? 0) > 0,
      pendingUserMessages: [
        ...(await this.#heldItems(id)).map(heldMessage),
        ...(inbox?.items ?? []).flatMap((item) => inboxMessage(item) ?? []),
      ],
      items,
      historyOffset: offset,
      historyTotalCount: committed.length,
      hideThinkingBlock: this.#runtime.settings.data.hideThinkingBlock,
      ...(modelRef ? { model: this.#modelOption(modelRef) } : {}),
      thinkingLevel: agent?.thinkingLevel ?? this.defaultThinkingLevel(),
      availableThinkingLevels: this.thinkingLevels(modelRef),
      availableModels: this.availableModels(),
      availableSkills: await this.#skills(meta.cwd),
      ...(this.#contextUsage(transcript.entries, modelRef)
        ? { contextUsage: this.#contextUsage(transcript.entries, modelRef) }
        : {}),
      uiState: {
        statuses: {},
        ...(options.editorText !== undefined
          ? { editorText: options.editorText }
          : {}),
        ...(busy
          ? {
              workingMessage:
                retryMessage(live) ??
                (this.#needsInput.has(id)
                  ? "Waiting for your answer…"
                  : "Working…"),
            }
          : {}),
      },
    }
  }

  async draftStateSync(draft: DraftSelection) {
    const modelRef = draft.model ?? this.defaultModel()
    return {
      type: "state_sync",
      sessionKey: draft.sessionKey,
      cwd: draft.cwd,
      draft: true,
      streaming: false,
      compacting: false,
      pendingUserMessages: [],
      items: [],
      historyOffset: 0,
      historyTotalCount: 0,
      hideThinkingBlock: this.#runtime.settings.data.hideThinkingBlock,
      ...(modelRef ? { model: this.#modelOption(modelRef) } : {}),
      thinkingLevel: draft.thinkingLevel ?? this.defaultThinkingLevel(),
      availableThinkingLevels: this.thinkingLevels(modelRef),
      availableModels: this.availableModels(),
      availableSkills: await this.#skills(draft.cwd),
      firstMessage: "",
      uiState: { statuses: {} },
    }
  }

  /** Send the session's state to the clients that show it. */
  async publishState(id: string, options: { editorText?: string } = {}) {
    if (!this.#metas.has(id)) return
    this.#hub.push(await this.stateSync(id, options), { sessionId: id })
  }

  async history(id: string, before: number | undefined, limit: number) {
    const { committed } = await this.items(id)
    const end = Math.min(before ?? committed.length, committed.length)
    const offset = Math.max(0, end - limit)
    return {
      ok: true,
      offset,
      limit,
      totalCount: committed.length,
      hasMoreBefore: offset > 0,
      items: committed.slice(offset, end),
    }
  }

  // ---------------------------------------------------------------------------
  // Creation and prompts

  async create(cwd: string, options: HostCreateOptions = {}) {
    const model = options.model ?? this.defaultModel()
    if (!model)
      throw badRequest("No model is available. Sign in to a provider first.")
    const thinkingLevel = options.thinkingLevel
      ? this.validateThinkingLevel(options.thinkingLevel)
      : this.defaultThinkingLevel()
    const now = Date.now()
    const parent = options.parent ? this.#metas.get(options.parent) : undefined
    const meta: SessionMeta = {
      cwd,
      createdAt: now,
      modifiedAt: now,
      firstMessage: "",
      messageCount: 0,
      ...(options.name
        ? { name: options.name.slice(0, 48), nameSource: "user" as const }
        : {}),
      ...(options.parent
        ? { parent: options.parent, depth: (parent?.depth ?? 0) + 1 }
        : {}),
      ...(options.spawnedByCall
        ? { spawnedByCall: options.spawnedByCall }
        : {}),
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.group && options.group !== cwd
        ? { group: options.group }
        : {}),
      ...(options.worktree ? { worktree: options.worktree } : {}),
    }
    const conversation = await this.#harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model, thinkingLevel, cwd },
        init: async (tx, conversationId) => {
          Object.assign(await tx.doc(SessionDoc, conversationId), meta)
        },
      },
      ctx
    )
    const id = publicId(conversation.id)
    meta.family = id
    this.#metas.set(id, meta)
    this.#docs.set(id, {})
    this.#transcripts.set(id, { entries: [] })
    this.#updateMeta(id, { family: id })
    if (options.parent || (options.profile && options.profile !== "full")) {
      const profile = findProfile(
        options.profile,
        this.#runtime.settings.data.profiles
      )
      await applyProfile(
        conversation,
        this.#runtime.registry,
        profile?.name === "full" ? undefined : profile,
        ctx,
        this.#toolOptions(meta)
      )
    }
    this.#scheduleSessionsBroadcast()
    if (options.parent) this.extensionStateChanged(options.parent, "children")
    return id
  }

  /** Remove the worktree that a session made. The session keeps its history. */
  async removeWorktree(id: string, force: boolean) {
    const meta = this.meta(id)
    if (!meta.worktree) return false
    if (this.isBusy(id))
      throw badRequest("Wait for the session to finish first.")
    try {
      await removeWorktree(meta.worktree, { force })
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : String(error))
    }
    return true
  }

  async prompt(
    id: string,
    input: {
      message: string
      images: PromptImageInput[]
      streamingBehavior?: "steer" | "followUp"
      thinkingLevel?: string
      requestId?: string
    }
  ) {
    const meta = this.meta(id)
    if (meta.archived) throw badRequest("This session was archived")
    const conversation = await this.conversation(id)
    if (input.thinkingLevel) {
      const level = this.validateThinkingLevel(input.thinkingLevel)
      const agent = await this.#doc(id, "agent")
      if (agent?.thinkingLevel !== level)
        await conversation.configure({ thinkingLevel: level }, ctx)
    }
    const resources = await this.#runtime.resources.get(meta.cwd)
    const expanded = expandPromptTemplate(
      expandSkillCommand(input.message, resources.skills),
      resources.prompts
    )
    const busy = this.isBusy(id)
    // A steer answers an open question; it still reaches the model as a steer.
    // A follow-up waits for the run to end, so it does not answer the question.
    if (
      busy &&
      input.streamingBehavior !== "followUp" &&
      this.#needsInput.has(id) &&
      expanded.trim()
    ) {
      await answerQuestion(
        this.#harness,
        conversationIdOf(id),
        undefined,
        expanded.trim(),
        "chat",
        ctx
      )
    }
    // A new queued prompt resumes a paused queue, ahead of the new prompt.
    if (this.isBusy(id) && (await this.#heldItems(id)).length > 0)
      await this.requeue(id)
    const submission = await conversation.submit(
      {
        type: "input",
        content: await userContent(expanded, input.images),
        whenBusy: input.streamingBehavior ?? (busy ? "steer" : "followUp"),
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
      ctx
    )
    const record = await submission.status(ctx)
    const queued = record.status === "queued"
    if (!meta.name) this.#autoName(id, input.message, input.images.length)
    return {
      queued,
      pendingId: queued ? `pending:${submission.id}` : undefined,
    }
  }

  /** Name an unnamed session from its first prompt: a heuristic now, the model's name soon. */
  #autoName(id: string, text: string, imageCount: number) {
    const heuristic = heuristicSessionName(text, imageCount)
    if (heuristic) {
      this.#updateMeta(id, { name: heuristic, nameSource: "auto" })
      this.#scheduleSessionsBroadcast()
      void this.publishStateIfWatched(id)
    }
    if (this.#naming.has(id)) return
    this.#naming.add(id)
    void this.#refineName(id, text, imageCount)
      .catch((error: unknown) => {
        this.#hub.push(
          {
            type: "auto_session_naming_error",
            sessionId: id,
            cwd: this.#metas.get(id)?.cwd,
            promptPreview: preview(text),
            imageCount,
            refinementReason: `${error instanceof Error ? error.message : String(error)}. Kept the current title.`,
          },
          { sessionId: id }
        )
      })
      .finally(() => this.#naming.delete(id))
  }

  async #refineName(id: string, text: string, imageCount: number) {
    const agent = await this.#doc(id, "agent")
    const model = this.#model(agent?.model ?? this.defaultModel())
    if (!model) throw new Error("No model selected")
    const name = await generateSessionName(this.#runtime.models, model, {
      text,
      imageCount,
      cwd: this.meta(id).cwd,
    })
    const meta = this.#metas.get(id)
    if (!meta || (meta.name && meta.nameSource === "user")) return
    this.#updateMeta(id, { name, nameSource: "auto" })
    this.#scheduleSessionsBroadcast()
    await this.publishStateIfWatched(id)
  }

  async publishStateIfWatched(id: string) {
    if (this.#watched(id)) await this.publishState(id)
  }

  /** Publish the state of every watched session, after a setting changed. */
  async publishWatchedStates() {
    for (const id of this.#watchers.keys()) await this.publishState(id)
  }

  async abort(id: string) {
    // Pause the queue: hold the queued prompts before the abort withdraws them.
    const withdrawn = await this.#withdrawInbox(id)
    if (withdrawn.length > 0)
      await this.#setHeld(id, [...(await this.#heldItems(id)), ...withdrawn])
    if (this.#needsInput.has(id))
      await cancelQuestions(this.#harness, conversationIdOf(id), ctx)
    const conversation = await this.conversation(id)
    const done = conversation.abort(ctx)
    await Promise.race([
      done,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  }

  /** Answer an open `ask_user` question from the web client. */
  async answer(
    id: string,
    questionId: string | undefined,
    value: QuestionAnswer["value"]
  ) {
    this.meta(id)
    const answered = await answerQuestion(
      this.#harness,
      conversationIdOf(id),
      questionId,
      value,
      "ui",
      ctx
    )
    if (!answered) throw conflict("The question is already closed")
  }

  profiles() {
    return allProfiles(this.#runtime.settings.data.profiles)
  }

  /** Give a session a tool profile; `full` clears it. */
  async setProfile(id: string, name: string) {
    this.meta(id)
    const profile = findProfile(name, this.#runtime.settings.data.profiles)
    if (!profile) throw badRequest(`Unknown profile: ${name}`)
    const conversation = await this.conversation(id)
    await applyProfile(
      conversation,
      this.#runtime.registry,
      profile.name === "full" ? undefined : profile,
      ctx,
      this.#toolOptions(this.meta(id))
    )
    this.#updateMeta(id, {
      profile: profile.name === "full" ? undefined : profile.name,
    })
    this.extensionStateChanged(id, "profile")
    void this.publishStateIfWatched(id)
    return profile.name
  }

  /** Give tools to a session or take them away, and apply its profile again. */
  async changeLimits(
    id: string,
    change: { add?: string[]; remove?: string[] }
  ): Promise<ToolLimits> {
    const meta = this.meta(id)
    const add = new Set(meta.limits?.add ?? [])
    const remove = new Set(meta.limits?.remove ?? [])
    for (const name of change.add ?? []) {
      add.add(name)
      remove.delete(name)
    }
    for (const name of change.remove ?? []) {
      remove.add(name)
      add.delete(name)
    }
    const limits: ToolLimits = {
      ...(add.size > 0 ? { add: [...add] } : {}),
      ...(remove.size > 0 ? { remove: [...remove] } : {}),
      ...(meta.limits?.denyCommands
        ? { denyCommands: meta.limits.denyCommands }
        : {}),
    }
    this.#updateMeta(id, { limits })
    const profile = findProfile(
      meta.profile,
      this.#runtime.settings.data.profiles
    )
    await applyProfile(
      await this.conversation(id),
      this.#runtime.registry,
      profile?.name === "full" ? undefined : profile,
      ctx,
      this.#toolOptions({ ...meta, limits })
    )
    this.extensionStateChanged(id, "profile")
    return limits
  }

  /** The child limits of a session, for `applyProfile`. */
  #toolOptions(meta: SessionMeta) {
    return {
      ...(meta.parent ? { child: { parent: meta.parent } } : {}),
      ...(meta.limits ? { limits: meta.limits } : {}),
    }
  }

  /**
   * Put a message from another session in the follow-up queue, after the
   * user's queued prompts. It never steers. A paused queue holds it with the
   * user's prompts, so it keeps its place.
   */
  async followUp(id: string, message: string, requestId: string) {
    const target = this.current(id) ?? id
    const meta = this.meta(target)
    if (meta.archived) return
    const held = await this.#heldItems(target)
    if (held.length > 0) {
      if (held.some((item) => item.requestId === requestId)) return
      await this.#setHeld(target, [
        ...held,
        {
          id: Math.max(Date.now(), ...held.map((item) => item.id + 1)),
          mode: "followUp",
          content: (await userContent(message, [])) as unknown as JsonValue,
          requestId,
        },
      ])
      return
    }
    const conversation = await this.conversation(target)
    await conversation.submit(
      {
        type: "input",
        content: await userContent(message, []),
        whenBusy: "followUp",
        requestId,
      },
      ctx
    )
  }

  /** Change the todo list of a session from the web client. */
  async changeTodo(id: string, change: TodoChange) {
    this.meta(id)
    try {
      return await updateTodo(this.#harness, conversationIdOf(id), change, ctx)
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Compact the session and wait until compaction ends. `compacted` is false
   * when there was nothing to compact.
   */
  async compact(id: string, instructions: string | undefined) {
    const conversation = await this.conversation(id)
    const taskId = await conversation.compact(instructions, ctx)
    this.#markDirty(id, { live: true })
    const { outcome } = (await this.#harness.waitForTask(taskId, ctx)).state
    if (outcome.status === "completed") {
      const { entryId, submissionId } = outcome.result
      return { compacted: entryId !== undefined || submissionId !== undefined }
    }
    if (outcome.status === "aborted") throw conflict("Compaction cancelled")
    throw conflict(
      outcome.error?.message ?? outcome.reason ?? "Compaction failed"
    )
  }

  // ---------------------------------------------------------------------------
  // Queued prompts

  async pendingMessages(id: string): Promise<PendingMessage[]> {
    const inbox = await this.#doc(id, "inbox")
    return [
      ...(await this.#heldItems(id)).map(heldMessage),
      ...(inbox?.items ?? []).flatMap((item) => inboxMessage(item) ?? []),
    ]
  }

  async #heldItems(id: string): Promise<HeldItem[]> {
    const cached = this.#held.get(id)
    if (cached) return cached
    const state = await this.#harness.snapshot(
      HeldQueueDoc,
      conversationIdOf(id),
      ctx
    )
    if (!this.#held.has(id)) this.#held.set(id, state?.items ?? [])
    return this.#held.get(id)!
  }

  async #setHeld(id: string, items: HeldItem[]) {
    this.#held.set(id, items)
    await this.#harness.commit(async (tx) => {
      const draft = await tx.doc(HeldQueueDoc, conversationIdOf(id))
      draft.items = JSON.parse(JSON.stringify(items)) as typeof draft.items
    }, ctx)
    void this.publishStateIfWatched(id)
  }

  /** Take the queued prompts out of the inbox, in order. */
  async #withdrawInbox(id: string): Promise<HeldItem[]> {
    const inbox = await this.#doc(id, "inbox")
    const withdrawn: HeldItem[] = []
    for (const item of inbox?.items ?? []) {
      if (item.mode === "write") continue
      const result = await this.#harness.abortSubmission(
        item.id,
        ctx,
        conversationIdOf(id)
      )
      if (result === "aborted")
        withdrawn.push({
          id: Number(item.id),
          mode: item.mode,
          content: item.content,
        })
    }
    return withdrawn
  }

  /** True when Pico holds queued prompts: the queue is paused. */
  async isQueuePaused(id: string) {
    return (await this.#heldItems(id)).length > 0
  }

  /**
   * Hold the queue while the user edits it, so that no prompt is sent with
   * old text. Returns whether the queue was already paused.
   */
  async holdQueue(id: string) {
    const held = await this.#heldItems(id)
    const wasPaused = held.length > 0
    const withdrawn = await this.#withdrawInbox(id)
    if (withdrawn.length > 0) await this.#setHeld(id, [...held, ...withdrawn])
    return { wasPaused }
  }

  /** Edit a paused queue in place. Nothing reaches the agent. */
  async #editHeld(
    id: string,
    held: HeldItem[],
    edits: PendingEdit[],
    remove: string[]
  ) {
    // The client can still name a held prompt by its inbox ID.
    const key = (pendingId: string) => pendingId.replace(/^(pending|held):/, "")
    const byPending = new Map(held.map((item) => [String(item.id), item]))
    const named = new Set(remove.map(key))
    const next: HeldItem[] = []
    let nextId = Math.max(Date.now(), ...held.map((item) => item.id + 1))
    let missed = 0
    for (const edit of edits) {
      if (edit.pendingId) {
        const pendingKey = key(edit.pendingId)
        if (named.has(pendingKey)) continue
        const item = byPending.get(pendingKey)
        if (!item) {
          missed += 1
          continue
        }
        named.add(pendingKey)
        const content = await editedContent(item.content, edit)
        if (contentIsEmpty(content)) continue
        next.push({
          ...item,
          content,
          mode: edit.streamingBehavior ?? item.mode,
        })
        continue
      }
      const content = await userContent(edit.text ?? "", edit.images ?? [])
      if (contentIsEmpty(content)) continue
      next.push({
        id: nextId++,
        mode: edit.streamingBehavior ?? "followUp",
        content: content as unknown as JsonValue,
      })
    }
    for (const item of held) {
      if (!named.has(String(item.id))) next.push(item)
    }
    await this.#setHeld(id, next)
    return { missed }
  }

  async removePending(id: string, pendingId: string) {
    if (pendingId.startsWith("held:")) {
      const held = await this.#heldItems(id)
      const next = held.filter((item) => `held:${item.id}` !== pendingId)
      if (next.length === held.length)
        throw notFound("Pending prompt not found")
      await this.#setHeld(id, next)
      return
    }
    const result = await this.#harness.abortSubmission(
      submissionIdFromPending(pendingId),
      ctx,
      conversationIdOf(id)
    )
    if (result === "not_found") throw notFound("Pending prompt not found")
    if (result !== "aborted") throw conflict("The prompt was already sent")
  }

  /**
   * Write the queue again: withdraw the queued prompts and submit them in the
   * new order, with new text, lanes, and new rows from `edits`. Prompts in
   * `remove` are withdrawn only. Queued prompts that `edits` does not name
   * keep their content and go to the end. Rows whose prompt was already sent
   * count as `missed`. On an idle conversation the first one starts a run.
   */
  async requeue(
    id: string,
    edits?: PendingEdit[],
    remove: string[] = [],
    options: { resume?: boolean } = {}
  ): Promise<{ missed: number }> {
    const held = await this.#heldItems(id)
    if (edits && held.length > 0) {
      const result = await this.#editHeld(id, held, edits, remove)
      if (options.resume) await this.requeue(id)
      return result
    }
    const inbox = await this.#doc(id, "inbox")
    const queued = (inbox?.items ?? []).filter(
      (item): item is Extract<InboxItem, { mode: "steer" | "followUp" }> =>
        item.mode !== "write"
    )
    const byPending = new Map(
      queued.map((item) => [`pending:${item.id}`, item])
    )
    type Planned = {
      item?: (typeof queued)[number]
      content: unknown
      mode: "steer" | "followUp"
    }
    const plan: Planned[] = []
    const withdraw: (typeof queued)[number][] = []
    const named = new Set<string>()
    let missed = 0

    for (const pendingId of remove) {
      const item = byPending.get(pendingId)
      if (!item || named.has(pendingId)) continue
      named.add(pendingId)
      withdraw.push(item)
    }
    for (const edit of edits ?? []) {
      if (edit.pendingId) {
        if (named.has(edit.pendingId)) continue
        const item = byPending.get(edit.pendingId)
        if (!item) {
          missed += 1
          continue
        }
        named.add(edit.pendingId)
        withdraw.push(item)
        const content = await editedContent(item.content, edit)
        if (contentIsEmpty(content)) continue
        plan.push({ item, content, mode: edit.streamingBehavior ?? item.mode })
        continue
      }
      const content = await userContent(edit.text ?? "", edit.images ?? [])
      if (contentIsEmpty(content)) continue
      plan.push({ content, mode: edit.streamingBehavior ?? "followUp" })
    }
    for (const item of queued) {
      if (named.has(`pending:${item.id}`)) continue
      withdraw.push(item)
      plan.push({ item, content: item.content, mode: item.mode })
    }
    // Resume a paused queue: its prompts go first.
    if (!edits && held.length > 0) {
      plan.unshift(
        ...heldInDeliveryOrder(held).map((item) => ({
          content: item.content,
          mode: item.mode,
        }))
      )
      await this.#setHeld(id, [])
    }

    const conversation = await this.conversation(id)
    const withdrawn = new Set<SubmissionId>()
    for (const item of withdraw) {
      const result = await this.#harness.abortSubmission(
        item.id,
        ctx,
        conversationIdOf(id)
      )
      if (result === "aborted") withdrawn.add(item.id)
      else if (edits) missed += 1
    }
    for (const planned of plan) {
      if (planned.item && !withdrawn.has(planned.item.id)) continue
      await conversation.submit(
        {
          type: "input",
          content: planned.content as never,
          whenBusy: planned.mode,
        },
        ctx
      )
    }
    return { missed }
  }

  // ---------------------------------------------------------------------------
  // Agent settings

  async setModel(id: string, provider: string, modelId: string) {
    if (!this.#runtime.models.getModel(provider, modelId))
      throw badRequest(`Unknown model: ${provider}/${modelId}`)
    const conversation = await this.conversation(id)
    await conversation.configure({ model: { provider, modelId } }, ctx)
    const agent = await conversation.agent(ctx)
    const levels = this.thinkingLevels({ provider, modelId })
    if (!levels.includes(agent.thinkingLevel)) {
      const level = levels.includes("medium")
        ? "medium"
        : (levels.at(-1) ?? "off")
      await conversation.configure(
        { thinkingLevel: level as ModelThinkingLevel },
        ctx
      )
    }
  }

  async setThinking(id: string, level: string) {
    const conversation = await this.conversation(id)
    await conversation.configure(
      { thinkingLevel: this.validateThinkingLevel(level) },
      ctx
    )
  }

  async agentState(id: string) {
    const agent = await this.#doc(id, "agent")
    const model = agent?.model ?? this.defaultModel()
    return {
      model: this.#modelOption(model),
      thinkingLevel: agent?.thinkingLevel ?? this.defaultThinkingLevel(),
      availableThinkingLevels: this.thinkingLevels(model),
    }
  }

  // ---------------------------------------------------------------------------
  // Session mutations

  rename(id: string, name: string) {
    const trimmed = name.trim().slice(0, 48)
    if (!trimmed) throw badRequest("name is required")
    this.meta(id)
    this.#updateMeta(id, { name: trimmed, nameSource: "user" })
    this.#scheduleSessionsBroadcast()
    void this.publishStateIfWatched(id)
    return trimmed
  }

  /** Generate a name with the session's model, as Pi's `/auto-name` does. */
  async generateName(id: string) {
    const meta = this.meta(id)
    const transcript = await this.transcript(id)
    const first = transcript.entries.find(isUserInputEntry)
    const message = first?.model?.[0] as never
    const text = message ? messageText(message) : meta.firstMessage
    const imageCount = message ? messageImages(message).length : 0
    if (!text.trim() && imageCount === 0) {
      throw badRequest(
        "Could not generate a session name from an empty conversation"
      )
    }
    let name: string
    let source: "llm" | "heuristic" = "llm"
    let reason: string | undefined
    try {
      const agent = await this.#doc(id, "agent")
      const model = this.#model(agent?.model ?? this.defaultModel())
      if (!model) throw new Error("No model selected")
      name = await generateSessionName(this.#runtime.models, model, {
        text,
        imageCount,
        cwd: meta.cwd,
      })
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
      source = "heuristic"
      const fallback =
        heuristicSessionName(text, imageCount) ?? cleanupCandidate(text)
      if (!fallback) throw badRequest(reason)
      name = fallback
    }
    this.#updateMeta(id, { name, nameSource: "auto" })
    this.#scheduleSessionsBroadcast()
    void this.publishStateIfWatched(id)
    return { name, source, ...(reason ? { reason } : {}) }
  }

  setRead(id: string, read: boolean) {
    this.meta(id)
    this.#viewers.setRead(id, read)
  }

  archive(id: string) {
    this.meta(id)
    if (this.isBusy(id))
      throw badRequest("Wait for the session to finish before archiving it.")
    this.#updateMeta(id, { archived: true, archivedAt: Date.now() })
    this.#viewers.forget(id)
    this.#scheduleSessionsBroadcast()
  }

  /** Make an archived session visible again. */
  restore(id: string) {
    const meta = this.meta(id)
    if (!meta.archived) return
    this.#updateMeta(id, { archived: undefined, archivedAt: undefined })
    this.#scheduleSessionsBroadcast()
  }

  /** Archived sessions, most recently archived first. */
  archivedSessions() {
    return [...this.#metas.entries()]
      .filter(([, meta]) => meta.archived && !meta.replacedBy)
      .sort(
        (left, right) =>
          (right[1].archivedAt ?? activity(right[1])) -
          (left[1].archivedAt ?? activity(left[1]))
      )
      .map(([id, meta]) => ({
        ...this.summary(id, new Set()),
        directory: meta.group ?? meta.cwd,
        ...(meta.archivedAt ? { archivedAt: iso(meta.archivedAt) } : {}),
      }))
  }

  async move(id: string, cwd: string) {
    const meta = this.meta(id)
    if (this.isBusy(id))
      throw badRequest("Wait for the session to finish before moving it.")
    const conversation = await this.conversation(id)
    await conversation.configure({ cwd }, ctx)
    this.#updateMeta(id, { cwd, modifiedAt: Date.now() })
    this.#scheduleSessionsBroadcast()
    void this.publishStateIfWatched(id)
    return { previousCwd: meta.cwd }
  }

  /** Archive sessions of a directory not active since `olderThanMs`. */
  cleanup(
    directory: string,
    olderThanMs: number,
    options: { dryRun: boolean; includeActive: boolean; activeIds: Set<string> }
  ) {
    const cutoff = Date.now() - olderThanMs
    const matching = this.directorySessions(directory).filter((id) => {
      if (!options.includeActive && options.activeIds.has(id)) return false
      if (this.isBusy(id)) return false
      return activity(this.meta(id)) < cutoff
    })
    if (!options.dryRun) for (const id of matching) this.archive(id)
    return {
      cutoff: new Date(cutoff).toISOString(),
      deleted: options.dryRun ? [] : matching,
      matching: matching.map((id) => ({
        ...this.summary(id, new Set()),
        activityAt: iso(activity(this.meta(id))),
      })),
    }
  }

  setLabel(id: string, entryId: string, label: string | undefined) {
    const meta = this.meta(id)
    const labels = { ...meta.labels }
    if (label?.trim())
      labels[entryId] = { label: label.trim(), timestamp: Date.now() }
    else delete labels[entryId]
    this.#updateMeta(id, { labels })
  }

  // ---------------------------------------------------------------------------
  // Tree, fork, and clone

  /** Conversations of a session's family, the visible one last. */
  #family(id: string) {
    const family = this.meta(id).family ?? id
    return [...this.#metas.entries()]
      .filter(([memberId, meta]) => (meta.family ?? memberId) === family)
      .map(([memberId]) => memberId)
      .sort(
        (left, right) =>
          Number(conversationIdOf(left)) - Number(conversationIdOf(right))
      )
  }

  async tree(id: string) {
    const members = this.#family(id)
    type Node = {
      entry: Record<string, unknown>
      label?: string
      labelTimestamp?: string
      streaming?: boolean
      children: Node[]
    }
    const nodes = new Map<string, Node>()
    const roots: Node[] = []
    const labels = this.meta(id).labels ?? {}
    let leafId: string | null = null

    for (const member of members) {
      const transcript = await this.transcript(member)
      const record = await this.#harness.commit(
        (tx) => tx.conversation(conversationIdOf(member)),
        ctx
      )
      let parentId: string | null = record?.parent
        ? String(record.parent.at)
        : null
      while (parentId && !nodes.has(parentId)) {
        // The fork point may be an entry the tree omits; walk back to one it shows.
        const index = transcript.entries.findIndex(
          (entry) => String(entry.id) === parentId
        )
        const previous = index > 0 ? transcript.entries[index - 1] : undefined
        parentId = previous ? String(previous.id) : null
      }
      for (const entry of transcript.entries) {
        const entryId = String(entry.id)
        if (nodes.has(entryId)) {
          parentId = entryId
          continue
        }
        if (publicId(entry.conversationId) !== member) continue
        const projected = projectTreeEntry(entry, parentId)
        if (!projected) continue
        const label = labels[entryId]
        const node: Node = {
          entry: projected,
          ...(label
            ? {
                label: label.label,
                labelTimestamp: new Date(label.timestamp).toISOString(),
              }
            : {}),
          children: [],
        }
        nodes.set(entryId, node)
        const parent = parentId ? nodes.get(parentId) : undefined
        if (parent) parent.children.push(node)
        else roots.push(node)
        parentId = entryId
      }
      if (member === id) leafId = parentId
    }
    const streaming = this.isBusy(id)
    if (streaming && leafId) {
      const leaf = nodes.get(leafId)
      if (leaf) leaf.streaming = true
    }
    return {
      ok: true,
      leafId,
      streamingEntryId: streaming ? leafId : null,
      tree: roots,
    }
  }

  /** User messages to fork from, newest last. */
  async forkMessages(id: string) {
    const transcript = await this.transcript(id)
    return transcript.entries.filter(isUserInputEntry).map((entry) => ({
      entryId: String(entry.id),
      text: messageText(entry.model?.[0] as never),
    }))
  }

  /** Image `index` of history entry `entryId`, for `imagePath` URLs. */
  async image(id: string, entryId: string, index: number | "details") {
    const { entry } = await this.#entry(id, entryId)
    const message = entry?.model?.[0] as { details?: unknown } | undefined
    const image =
      index === "details"
        ? detailsImage(message?.details)
        : messageImages(message as never)[index]
    return image
      ? { mimeType: image.mimeType, bytes: Buffer.from(image.data, "base64") }
      : undefined
  }

  async #entry(id: string, entryId: string) {
    const transcript = await this.transcript(id)
    const index = transcript.entries.findIndex(
      (entry) => String(entry.id) === entryId
    )
    return {
      transcript,
      index,
      entry: index >= 0 ? transcript.entries[index] : undefined,
    }
  }

  /**
   * Make a new conversation from `source` up to `at` (inclusive), or an empty
   * one when `at` is undefined, with the source's agent and directory.
   */
  async #forkConversation(
    source: string,
    at: string | undefined,
    meta: Partial<SessionMeta>
  ) {
    const sourceMeta = this.meta(source)
    const now = Date.now()
    const base: SessionMeta = {
      cwd: sourceMeta.cwd,
      createdAt: now,
      modifiedAt: now,
      firstMessage: "",
      messageCount: 0,
      ...meta,
    }
    let conversationId: ConversationId
    if (at === undefined) {
      const agent = await this.#doc(source, "agent")
      const conversation = await this.#harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: {
            ...(agent?.model ? { model: agent.model } : {}),
            ...(agent?.thinkingLevel
              ? { thinkingLevel: agent.thinkingLevel }
              : {}),
            cwd: sourceMeta.cwd,
          },
          init: async (tx, id) => {
            Object.assign(
              await tx.doc(SessionDoc, id),
              JSON.parse(JSON.stringify(base))
            )
          },
        },
        ctx
      )
      conversationId = conversation.id
    } else {
      const owner =
        (await this.#entry(source, at)).entry?.conversationId ??
        conversationIdOf(source)
      const parent = await this.#harness.conversation(owner, ctx)
      if (!parent) throw notFound("Fork source not found")
      const fork = await parent.fork(
        Number(at) as never,
        {
          ownership: { kind: "ownerless" },
          agent: { cwd: sourceMeta.cwd },
          init: async (tx, id) => {
            Object.assign(
              await tx.doc(SessionDoc, id),
              JSON.parse(JSON.stringify(base))
            )
          },
        },
        ctx
      )
      conversationId = fork.id
    }
    const id = publicId(conversationId)
    this.#metas.set(id, base)
    this.#docs.set(id, {})
    const transcript = await this.transcript(id)
    const summary = summarize(transcript.entries)
    this.#updateMeta(id, {
      ...summary,
      ...(meta.family ? {} : { family: id }),
    })
    return id
  }

  /** Fork at a user message: the new session ends before it and offers its text again. */
  async fork(id: string, entryId: string, contextId: string) {
    const { transcript, index, entry } = await this.#entry(id, entryId)
    if (!entry || !isUserInputEntry(entry))
      throw notFound("Fork point not found")
    const previous = index > 0 ? transcript.entries[index - 1] : undefined
    const forked = await this.#forkConversation(
      id,
      previous ? String(previous.id) : undefined,
      this.meta(id).name
        ? {
            name: `${this.meta(id).name}`.slice(0, 48),
            nameSource: "auto" as const,
          }
        : {}
    )
    this.#viewers.selectSession(contextId, forked)
    this.#scheduleSessionsBroadcast()
    const editorText = messageText(entry.model?.[0] as never)
    this.#watchOnce(forked, editorText)
    return forked
  }

  async clone(id: string, contextId: string) {
    const transcript = await this.transcript(id)
    const last = transcript.entries.at(-1)
    const meta = this.meta(id)
    const cloned = await this.#forkConversation(
      id,
      last ? String(last.id) : undefined,
      {
        ...(meta.name
          ? { name: meta.name, nameSource: meta.nameSource ?? "auto" }
          : {}),
        ...(meta.labels ? { labels: meta.labels } : {}),
      }
    )
    this.#viewers.selectSession(contextId, cloned)
    this.#scheduleSessionsBroadcast()
    this.#watchOnce(cloned)
    return cloned
  }

  /**
   * Move a session to another point of its tree. The session continues in a
   * fork at that point: after a user message's parent (its text returns to the
   * editor), or at any other entry.
   */
  async navigate(id: string, targetId: string) {
    if (this.isBusy(id))
      throw badRequest(
        "Wait for the session to finish before navigating the tree."
      )
    let owner: string | undefined
    let target: EntryRecord | undefined
    let targetIndex = -1
    let ownerTranscript: Transcript | undefined
    for (const member of this.#family(id)) {
      const transcript = await this.transcript(member)
      const index = transcript.entries.findIndex(
        (entry) => String(entry.id) === targetId
      )
      if (index >= 0) {
        owner = member
        target = transcript.entries[index]
        targetIndex = index
        ownerTranscript = transcript
        if (member === id) break
      }
    }
    if (!owner || !target || !ownerTranscript)
      throw notFound("tree target not found")
    const current = await this.transcript(id)
    if (String(current.entries.at(-1)?.id) === targetId) {
      return { cancelled: false, aborted: false }
    }
    let at: string | undefined = targetId
    let editorText: string | undefined
    if (isUserInputEntry(target)) {
      editorText = messageText(target.model?.[0] as never)
      const previous =
        targetIndex > 0 ? ownerTranscript.entries[targetIndex - 1] : undefined
      at = previous ? String(previous.id) : undefined
    }
    const meta = this.meta(id)
    const replacement = await this.#forkConversation(owner, at, {
      cwd: meta.cwd,
      ...(meta.name
        ? { name: meta.name, nameSource: meta.nameSource ?? "auto" }
        : {}),
      ...(meta.labels ? { labels: meta.labels } : {}),
      family: meta.family ?? id,
    })
    this.#updateMeta(id, { replacedBy: replacement })
    for (const [contextId, context] of this.#viewers.all()) {
      if (context.selectedSession === id)
        this.#viewers.selectSession(contextId, replacement)
    }
    this.#scheduleSessionsBroadcast()
    this.#watchOnce(replacement, editorText)
    return {
      cancelled: false,
      aborted: false,
      ...(editorText !== undefined ? { editorText } : {}),
    }
  }

  /** Publish a new session's first state with optional editor text. */
  #watchOnce(id: string, editorText?: string) {
    void this.stateSync(
      id,
      editorText !== undefined ? { editorText } : {}
    ).then((payload) => {
      this.#hub.push(payload, { sessionId: id })
    })
  }
}

function activity(meta: SessionMeta) {
  return meta.lastMessageAt ?? meta.modifiedAt ?? meta.createdAt
}

function retryMessage(live: LiveState | undefined) {
  const retry = live?.generation?.retry
  if (!retry) return undefined
  const seconds = Math.max(0, Math.round((retry.at - Date.now()) / 1000))
  return `Retrying in ${seconds}s: ${retry.error}`
}

function summarize(entries: readonly EntryRecord[]): Partial<SessionMeta> {
  let messageCount = 0
  let firstMessage = ""
  let lastMessageAt: number | undefined
  let lastUserMessageAt: number | undefined
  let lastMessagePreview: string | undefined
  for (const entry of entries) {
    if (!entryStartsItem(entry) || entry.kind === "pi.compaction") continue
    messageCount += 1
    const message = entry.model?.[0] as { timestamp?: number } | undefined
    const text = messageText(message as never)
    const time = message?.timestamp
    if (time) lastMessageAt = time
    if (isUserInputEntry(entry)) {
      if (time) lastUserMessageAt = time
      if (!firstMessage) firstMessage = preview(text) || "Image"
    }
    if (text.trim()) lastMessagePreview = preview(text)
  }
  return {
    messageCount,
    firstMessage,
    ...(lastMessageAt ? { lastMessageAt } : {}),
    ...(lastUserMessageAt ? { lastUserMessageAt } : {}),
    ...(lastMessagePreview ? { lastMessagePreview } : {}),
  }
}

const TREE_PREVIEW = 2000

/** An entry as the session tree shows it, in the shape of Pi's tree. */
function projectTreeEntry(entry: EntryRecord, parentId: string | null) {
  const message = entry.model?.[0] as
    | {
        role?: string
        content?: unknown
        stopReason?: string
        errorMessage?: string
        toolCallId?: string
        toolName?: string
        timestamp?: number
      }
    | undefined
  const base = {
    id: String(entry.id),
    parentId,
    timestamp: message?.timestamp
      ? new Date(message.timestamp).toISOString()
      : undefined,
  }
  if (
    isUserInputEntry(entry) ||
    entry.kind === "pi.assistant" ||
    entry.kind === "pi.tool-result"
  ) {
    const toolCalls = Array.isArray(message?.content)
      ? (
          message.content as Array<{
            type?: string
            id?: string
            name?: string
            arguments?: unknown
          }>
        )
          .filter((part) => part?.type === "toolCall")
          .map((part) => ({
            id: part.id,
            name: part.name,
            preview: JSON.stringify(part.arguments ?? {}).slice(0, 200),
          }))
      : []
    return {
      ...base,
      type: "message",
      message: {
        role: isUserInputEntry(entry) ? "user" : (message?.role ?? "assistant"),
        text: messageText(message as never).slice(0, TREE_PREVIEW),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(message?.stopReason ? { stopReason: message.stopReason } : {}),
        ...(message?.errorMessage
          ? { errorMessage: message.errorMessage.slice(0, TREE_PREVIEW) }
          : {}),
        ...(message?.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message?.toolName ? { toolName: message.toolName } : {}),
      },
    }
  }
  if (entry.kind === "pi.compaction") {
    return {
      ...base,
      type: "compaction",
      summary: messageText(message as never).slice(0, TREE_PREVIEW),
    }
  }
  return undefined
}
