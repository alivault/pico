/**
 * The `memory` extension: facts about a project that the agent keeps across
 * sessions.
 *
 * Facts live in a session-scope document family, one member for each project
 * (the git repository root, or the directory outside git) and one `global`
 * member. A prompt section shows them to the model; the user can edit them
 * in the Agent panel. Forks and child sessions of a project share its memory.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  AgentDoc,
  defineDocFamily,
  defineExtension,
  defineTool,
  section,
  type ConversationId,
  type DocumentReader,
  type Harness,
} from "@earendil-works/pi-durable"

import { repoRoot } from "../services/worktree.ts"
import { errorResult, json, registerState, textResult } from "./util.ts"

export type MemoryFact = {
  id: string
  text: string
  tags?: string[]
  source: "agent" | "user"
  updatedAt: number
}

export type MemoryState = {
  project: string
  facts: MemoryFact[]
  nextId: number
  applied: string[]
}

export const MemoryDoc = defineDocFamily<MemoryState, string>({
  kind: "pico.memory",
  version: 1,
  scope: "session",
  family: true,
  initial: (project) => ({ project, facts: [], nextId: 1, applied: [] }),
})

export const GLOBAL_MEMORY = "global"
const SECTION_LIMIT = 6000

const roots = new Map<string, Promise<string>>()

/** The memory key of a directory: its main repository root, or itself. */
export function projectKey(cwd: string) {
  let root = roots.get(cwd)
  if (!root) {
    root = repoRoot(cwd).then((found) => found ?? cwd)
    roots.set(cwd, root)
  }
  return root
}

async function cwdOfConversation(
  reader: DocumentReader,
  conversationId: ConversationId,
  context: Context
) {
  const agent = await reader.snapshot(AgentDoc, conversationId, context)
  return agent?.cwd
}

export type MemoryChange =
  | { op: "add"; text: string; tags?: string[]; source?: MemoryFact["source"] }
  | { op: "update"; id: string; text?: string; tags?: string[] }
  | { op: "remove"; id: string }

export function applyMemory(state: MemoryState, change: MemoryChange) {
  if (change.op === "add") {
    const text = change.text.trim()
    if (!text) throw new Error("A fact needs text")
    const duplicate = state.facts.find(
      (fact) => fact.text.toLowerCase() === text.toLowerCase()
    )
    if (duplicate) return duplicate
    const fact: MemoryFact = {
      id: String(state.nextId++),
      text,
      ...(change.tags?.length ? { tags: change.tags } : {}),
      source: change.source ?? "agent",
      updatedAt: Date.now(),
    }
    state.facts.push(fact)
    return fact
  }
  const fact = state.facts.find((item) => item.id === change.id.trim())
  if (!fact) throw new Error(`No fact with id ${change.id}`)
  if (change.op === "remove") {
    state.facts.splice(state.facts.indexOf(fact), 1)
    return fact
  }
  if (change.text?.trim()) fact.text = change.text.trim()
  if (change.tags) fact.tags = change.tags
  fact.updatedAt = Date.now()
  return fact
}

/** Change memory from outside a tool, for the web client. */
export async function changeMemory(
  harness: Pick<Harness, "commit">,
  key: string,
  change: MemoryChange,
  context: Context
) {
  return harness.commit(async (tx) => {
    const draft = (await tx.doc(MemoryDoc, key, key)) as unknown as MemoryState
    applyMemory(draft, change)
    return json(draft.facts)
  }, context)
}

export async function readMemory(
  reader: DocumentReader,
  key: string,
  context: Context
) {
  const state = await reader.snapshot(MemoryDoc, key, context)
  return state?.facts ?? []
}

function formatFacts(facts: readonly MemoryFact[]) {
  return facts
    .map(
      (fact) =>
        `- [${fact.id}] ${fact.text}${fact.tags?.length ? ` (${fact.tags.join(", ")})` : ""}`
    )
    .join("\n")
}

/** Facts for the prompt, newest first when they do not all fit. */
export function memorySection(
  project: readonly MemoryFact[],
  global: readonly MemoryFact[]
) {
  if (project.length === 0 && global.length === 0) return undefined
  const parts: string[] = []
  let used = 0
  let hidden = 0
  const add = (title: string, facts: readonly MemoryFact[]) => {
    const kept: MemoryFact[] = []
    for (const fact of [...facts].sort(
      (left, right) => right.updatedAt - left.updatedAt
    )) {
      if (used + fact.text.length > SECTION_LIMIT) {
        hidden += 1
        continue
      }
      used += fact.text.length + 8
      kept.push(fact)
    }
    if (kept.length)
      parts.push(
        `${title}:\n${formatFacts(kept.sort((left, right) => Number(left.id) - Number(right.id)))}`
      )
  }
  add("About this project", project)
  add("About the user, for all projects", global)
  return [
    ...parts,
    hidden
      ? `(${hidden} older facts are not shown; find them with memory { op: "search" }.)`
      : "",
    "Keep this memory current with the memory tool: add durable facts and preferences, update or remove facts that are wrong.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

registerState({
  key: "memory",
  kinds: ["pico.memory"],
  async read(reader, conversationId, context) {
    const cwd = await cwdOfConversation(reader, conversationId, context)
    if (!cwd) return undefined
    const project = await projectKey(cwd)
    return json({
      project,
      facts: await readMemory(reader, project, context),
      global: await readMemory(reader, GLOBAL_MEMORY, context),
    })
  },
})

export function createMemoryExtension() {
  const tool = defineTool({
    name: "memory",
    description: [
      "Keep facts across sessions: conventions, commands, decisions, and user preferences. Project facts are shared by every session in this repository; global facts by all projects.",
      "Ops: add (text, tags), update (id, text), remove (id), list, search (query). Save only facts that stay true; do not save task progress (use todo for that).",
    ].join(" "),
    parameters: Type.Object({
      op: Type.Union(
        ["add", "update", "remove", "list", "search"].map((op) =>
          Type.Literal(op)
        )
      ),
      text: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      query: Type.Optional(Type.String()),
      scope: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("global")])
      ),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const agent = await api.agent(context)
      const cwd = agent.cwd ?? api.env?.cwd
      const key =
        args.scope === "global" || !cwd ? GLOBAL_MEMORY : await projectKey(cwd)
      const op = String(args.op)
      if (op === "list" || op === "search") {
        const facts = await readMemory(api, key, context)
        const query = args.query?.toLowerCase().trim()
        const matches = query
          ? facts.filter(
              (fact) =>
                fact.text.toLowerCase().includes(query) ||
                fact.tags?.some((tag) => tag.toLowerCase().includes(query))
            )
          : facts
        return textResult(
          matches.length
            ? `${matches.length} fact(s) in ${key === GLOBAL_MEMORY ? "global memory" : key}:\n${formatFacts(matches)}`
            : "No facts found."
        )
      }
      let change: MemoryChange
      if (op === "add") {
        if (!args.text?.trim()) return errorResult("add needs text")
        change = {
          op,
          text: args.text,
          ...(args.tags ? { tags: args.tags } : {}),
        }
      } else if (op === "update" || op === "remove") {
        if (!args.id) return errorResult(`${op} needs an id`)
        change =
          op === "update"
            ? {
                op,
                id: args.id,
                ...(args.text ? { text: args.text } : {}),
                ...(args.tags ? { tags: args.tags } : {}),
              }
            : { op, id: args.id }
      } else return errorResult(`Unknown op ${op}`)
      try {
        const fact = await api.commit(async (tx) => {
          const draft = (await tx.doc(
            MemoryDoc,
            key,
            key
          )) as unknown as MemoryState
          if (draft.applied.includes(api.callId)) return undefined
          const result = applyMemory(draft, change)
          draft.applied.push(api.callId)
          if (draft.applied.length > 100)
            draft.applied.splice(0, draft.applied.length - 100)
          return json(result)
        }, context)
        return textResult(
          fact
            ? `${op === "add" ? "Saved" : op === "update" ? "Updated" : "Removed"} fact ${fact.id}: ${fact.text}`
            : "Done."
        )
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    },
  })

  return defineExtension({
    name: "memory",
    tools: [tool],
    sections: [
      section("memory", async (input, context) => {
        const cwd = input.agent.cwd ?? input.env?.cwd
        const project = cwd ? await projectKey(cwd) : undefined
        return memorySection(
          project ? await readMemory(input.read, project, context) : [],
          await readMemory(input.read, GLOBAL_MEMORY, context)
        )
      }),
    ],
  })
}
