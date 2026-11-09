/**
 * Search across agents: the hits of the search index, grouped by agent.
 *
 * A hit in a conversation that tree navigation replaced counts for the
 * agent that replaced it. Conversations that are not agents (for example
 * of tasks) and deleted agents drop out. Archived agents stay, marked.
 */
import type { Agents } from "./agents.ts"
import {
  matchQuery,
  type IndexedEntry,
  type IndexedKind,
  type SearchIndex,
} from "../services/search-index.ts"

export type AgentSearchInput = {
  query: string
  /** Only agents of this sidebar project. */
  project?: string
  /** Leave out this agent, for example the one that searches. */
  exclude?: string
  /** The most agents (default 10, at most 50). */
  limit?: number
  /** The last word may be the start of a word, for search as you type. */
  prefix?: boolean
}

export type AgentSearchHit = {
  entryId: number
  kind: IndexedKind
  ts?: number
  snippet: string
}

export type AgentSearchMatch = {
  agentId: string
  title: string
  cwd: string
  project: string
  archived?: boolean
  lastMessageAt?: string
  hits: AgentSearchHit[]
}

export type AgentSearchResult = {
  agents: AgentSearchMatch[]
  /** Present while the index is not complete. */
  indexing?: { lastEntry: number; newestEntry: number }
}

export type AroundResult = {
  agentId: string
  title: string
  entries: IndexedEntry[]
}

/** How much a match in a tool result counts, against one in a message. */
const TOOL_WEIGHT = 0.4

/** The rank of a hit, lower is better (bm25 ranks are negative). */
function weighted(hit: { rank: number; kind: IndexedKind }) {
  return hit.kind === "tool" ? hit.rank * TOOL_WEIGHT : hit.rank
}

/** The most hits for one agent. */
const HITS_PER_AGENT = 3
/** The hits that one search looks at. */
const MAX_HITS = 400

export class AgentSearch {
  readonly #index: SearchIndex
  readonly #agents: Agents

  constructor(index: SearchIndex, agents: Agents) {
    this.#index = index
    this.#agents = agents
  }

  /** The agent of a conversation, or undefined when it is not an agent. */
  #agentOf(conversation: number) {
    const id = this.#agents.current(`s${conversation}`)
    return id && this.#agents.has(id) ? id : undefined
  }

  async search(input: AgentSearchInput): Promise<AgentSearchResult> {
    if (this.#index.error) throw new Error(this.#index.error)
    // Take the newest entries first, but do not make the search slow.
    await this.#index.catchUp(300)
    const limit = Math.min(50, Math.max(1, input.limit ?? 10))
    const prefix = Boolean(input.prefix)
    const all = matchQuery(input.query, { prefix })
    if (!all) return { agents: [] }
    let hits = this.#index.search(all, MAX_HITS)
    // With no hit for all words, one word is enough.
    const any = matchQuery(input.query, { prefix, any: true })
    if (hits.length === 0 && any && any !== all)
      hits = this.#index.search(any, MAX_HITS)
    // Tool output is noisy: a match in a message counts more.
    hits = hits.toSorted((left, right) => weighted(left) - weighted(right))
    const groups = new Map<string, AgentSearchMatch>()
    for (const hit of hits) {
      const agentId = this.#agentOf(hit.conversation)
      if (!agentId || agentId === input.exclude) continue
      const project = this.#agents.projectOf(agentId)
      if (input.project && project !== input.project) continue
      let group = groups.get(agentId)
      if (!group) {
        if (groups.size >= limit) continue
        const meta = this.#agents.meta(agentId)
        const summary = this.#agents.summary(agentId, new Set())
        group = {
          agentId,
          title: summary.title,
          cwd: meta.cwd,
          project,
          ...(meta.archived ? { archived: true } : {}),
          ...(summary.lastMessageAt
            ? { lastMessageAt: summary.lastMessageAt }
            : {}),
          hits: [],
        }
        groups.set(agentId, group)
      }
      // A conversation and its tree navigation copy can have the same text.
      if (
        group.hits.length < HITS_PER_AGENT &&
        !group.hits.some((item) => item.snippet === hit.snippet)
      )
        group.hits.push({
          entryId: hit.entryId,
          kind: hit.kind,
          ...(hit.ts ? { ts: hit.ts } : {}),
          snippet: hit.snippet,
        })
    }
    const status = this.#index.status()
    return {
      agents: [...groups.values()],
      ...(status.ready
        ? {}
        : {
            indexing: {
              lastEntry: status.lastEntry,
              newestEntry: status.newestEntry,
            },
          }),
    }
  }

  /**
   * The messages around entry `entryId`: `count` entries, with the entry
   * near the middle. The entry names its conversation, so this also works
   * for entries before a compaction or a tree navigation.
   */
  around(entryId: number, count: number): AroundResult {
    const entry = this.#index.entry(entryId)
    if (!entry) throw new Error(`Unknown entry: ${entryId}`)
    const agentId = this.#agentOf(entry.conversation)
    if (!agentId) throw new Error(`Entry ${entryId} is not in an agent.`)
    const total = Math.min(50, Math.max(1, count))
    const before = Math.floor((total - 1) / 2)
    return {
      agentId,
      title: this.#agents.summary(agentId, new Set()).title,
      entries: this.#index.around(
        entry.conversation,
        entryId,
        before,
        total - 1 - before
      ),
    }
  }
}

/** The text of `around` entries, like the transcript of `agents read`. */
export function aroundText(entries: IndexedEntry[], focus: number) {
  const heading: Record<IndexedKind, string> = {
    user: "User",
    assistant: "Assistant",
    tool: "Tool result (start)",
    summary: "Summary of earlier work",
  }
  return entries
    .map(
      (entry) =>
        `## ${heading[entry.kind]} (entry ${entry.entryId}${entry.entryId === focus ? ", the match" : ""})\n${entry.text}`
    )
    .join("\n\n")
}

/** A snippet with its match in `**`, for text output. */
export function plainSnippet(snippet: string) {
  return snippet
    .replace(/\uE000/g, "**")
    .replace(/\uE001/g, "**")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * A search result as text, for agents and the command line. `name` gives
 * the ID that other calls take, for example `workbox:s12`.
 */
export function formatSearchResult(
  query: string,
  result: AgentSearchResult,
  name: (id: string) => string = (id) => id
) {
  const lines: string[] = []
  if (result.indexing)
    lines.push(
      `The search index is still being built (${result.indexing.lastEntry} of ${result.indexing.newestEntry} entries), so results can be missing.`
    )
  if (result.agents.length === 0) {
    lines.push(`No agent has messages that match "${query}".`)
    return lines.join("\n")
  }
  for (const match of result.agents) {
    lines.push(
      `${name(match.agentId)} — ${match.title}${match.archived ? " [archived]" : ""} (${match.cwd})`
    )
    for (const hit of match.hits) {
      const day = hit.ts ? new Date(hit.ts).toISOString().slice(0, 10) : ""
      lines.push(
        `  entry ${hit.entryId} (${hit.kind}${day ? `, ${day}` : ""}): ${plainSnippet(hit.snippet)}`
      )
    }
  }
  const first = result.agents[0]!
  lines.push(
    "",
    `To read the messages around a hit, read agent ${name(first.agentId)} with entry ${first.hits[0]?.entryId ?? "N"}.`
  )
  return lines.join("\n")
}
