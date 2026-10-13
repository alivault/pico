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

const TOOL_SNIPPETS: Record<string, string> = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
  codemode: "Run JavaScript that calls other tools",
  tool_search: "Search for and load tools that are not loaded yet",
  web_search: "Search the web",
  fetch_content: "Fetch URL content as readable text",
  get_search_content: "Read stored search results and fetched content",
  source_check: "Gather web sources for a claim",
}

const TOOL_GUIDELINES: Record<string, string[]> = {
  read: ["Use read to examine files instead of cat or sed."],
  edit: [
    "Use edit for precise changes (edits[].oldText must match exactly)",
    "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
    "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
    "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
  ],
  write: ["Use write only for new files or complete rewrites."],
  web_search: [
    "Use web_search when current, external, or linked information could help",
  ],
}

function toolNames(input: PromptInput) {
  return input.agent.tools.map((tool) => tool.name)
}

function cwdOf(input: PromptInput) {
  return input.agent.cwd ?? input.env?.cwd ?? process.cwd()
}

function firstSentence(text: string) {
  const line = text.split("\n").find((part) => part.trim()) ?? ""
  const end = line.search(/[.!?](\s|$)/)
  return (end >= 0 ? line.slice(0, end + 1) : line).trim()
}

function rules(names: readonly string[]) {
  const result: string[] = []
  const add = (rule: string) => {
    const normalized = rule.trim()
    if (normalized && !result.includes(normalized)) result.push(normalized)
  }
  if (names.includes("bash")) add("Use bash for file operations like ls, rg, find")
  for (const name of names) for (const rule of TOOL_GUIDELINES[name] ?? []) add(rule)
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
        async (input) => (await resources.get(cwdOf(input))).customSystemPrompt ?? DEFAULT_PREAMBLE,
        { tag: false }
      ),
      section("tools", (input) => {
        const lines = input.agent.tools.map(
          (tool) => `- ${tool.name}: ${TOOL_SNIPPETS[tool.name] ?? firstSentence(tool.description)}`
        )
        const list = lines.length > 0 ? lines.join("\n") : "(none)"
        return `${list}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`
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
        const reader = names.includes("read") ? "read" : names.includes("bash") ? "bash" : undefined
        if (!reader) return undefined
        const skills = (await resources.get(cwdOf(input))).skills
        if (skills.length === 0) return undefined
        return formatSkillsForPrompt(skills, reader).trim() || undefined
      }),
      section("cwd", (input) => cwdOf(input).replace(/\\/g, "/")),
    ],
  })
}
