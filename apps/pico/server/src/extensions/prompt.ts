/**
 * The `pico` extension: the system prompt, built the way the Pi coding agent
 * builds it. A preamble, the tools, rules, project context (AGENTS.md),
 * skills, and the working directory. Each part is a durable prompt section,
 * so only parts that change are sent again.
 */
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent"
import {
  defineExtension,
  section,
  type PromptInput,
} from "@earendil-works/pi-durable"

import type { ResourceCache } from "../core/resources.ts"

const DEFAULT_PREAMBLE =
  "You are an expert coding assistant operating inside Pico, a coding agent harness built on pi. You help users by reading files, executing commands, editing code, and writing new files."

/** At most this many deferred tool names in the prompt. */
const MAX_DEFERRED_NAMES = 30

const TOOL_GUIDELINES: Record<string, string[]> = {
  read: ["Use read to examine files instead of cat or sed."],
  edit: [
    "Make all changes to one file in one edit call, with one entry in edits[] for each change.",
  ],
  write: ["Use write only for new files or complete rewrites."],
  web_search: [
    "Use web_search when current, external, or linked information could help",
  ],
  ask_user: [
    "When you need an answer, a choice, or a confirmation from the user, ask with ask_user. Do not end your turn with a question in plain text.",
  ],
}

function toolNames(input: PromptInput) {
  return input.agent.tools.map((tool) => tool.name)
}

function cwdOf(input: PromptInput) {
  return input.agent.cwd ?? input.env?.cwd ?? process.cwd()
}

function rules(names: readonly string[]) {
  const result: string[] = []
  const add = (rule: string) => {
    const normalized = rule.trim()
    if (normalized && !result.includes(normalized)) result.push(normalized)
  }
  if (names.includes("bash"))
    add("Use bash for file operations like ls, rg, find")
  for (const name of names)
    for (const rule of TOOL_GUIDELINES[name] ?? []) add(rule)
  add("Be concise in your responses")
  add("Show file paths clearly when working with files")
  return result.map((rule) => `- ${rule}`).join("\n")
}

export function createPromptExtension(resources: ResourceCache) {
  return defineExtension({
    name: "pico",
    sections: [
      section(
        "preamble",
        async (input) =>
          (await resources.get(cwdOf(input))).customSystemPrompt ??
          DEFAULT_PREAMBLE,
        { tag: false }
      ),
      // The model gets the active tools as tool definitions, so this
      // section names only the deferred tools that tool_search can load.
      section("deferred_tools", (input) => {
        const deferred = input.agent.deferred.map((tool) => tool.name)
        if (
          deferred.length === 0 ||
          !input.agent.tools.some((tool) => tool.name === "tool_search")
        )
          return undefined
        const more = deferred.length - MAX_DEFERRED_NAMES
        return `Load these tools with tool_search when you need them: ${deferred.slice(0, MAX_DEFERRED_NAMES).join(", ")}${more > 0 ? `, and ${more} more` : ""}.`
      }),
      section("rules", (input) => rules(toolNames(input))),
      section("addendum", async (input) => {
        const append = (await resources.get(cwdOf(input))).appendSystemPrompt
        return append.length > 0 ? append.join("\n\n") : undefined
      }),
      section("project_context", async (input) => {
        const files = (await resources.get(cwdOf(input))).agentsFiles
        if (files.length === 0) return undefined
        return [
          "Project-specific instructions and guidelines:",
          ...files.map(
            ({ path, content }) =>
              `<project_instructions path="${path}">\n${content}\n</project_instructions>`
          ),
        ].join("\n\n")
      }),
      section("skills", async (input) => {
        const names = toolNames(input)
        const reader = names.includes("read")
          ? "read"
          : names.includes("bash")
            ? "bash"
            : undefined
        if (!reader) return undefined
        const skills = (await resources.get(cwdOf(input))).skills
        if (skills.length === 0) return undefined
        return formatSkillsForPrompt(skills, reader).trim() || undefined
      }),
      section("cwd", (input) => cwdOf(input).replace(/\\/g, "/")),
    ],
  })
}
