/**
 * Pi resources per working directory: skills, prompt templates, and context
 * files (AGENTS.md), loaded the way the Pi coding agent loads them. Pi
 * extensions are not loaded. Results are cached briefly, so a new run sees
 * files the user changed a moment ago.
 */
import { readFileSync } from "node:fs"

import {
  DefaultResourceLoader,
  SettingsManager,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-coding-agent"

const CACHE_MS = 5_000

export type PiResources = {
  skills: Skill[]
  prompts: PromptTemplate[]
  agentsFiles: Array<{ path: string; content: string }>
  appendSystemPrompt: string[]
  customSystemPrompt: string | undefined
}

type CacheEntry = { loadedAt: number; resources: Promise<PiResources> }

export class ResourceCache {
  readonly #agentDir: string
  readonly #cache = new Map<string, CacheEntry>()

  constructor(agentDir: string) {
    this.#agentDir = agentDir
  }

  async get(cwd: string): Promise<PiResources> {
    const cached = this.#cache.get(cwd)
    if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.resources
    const resources = this.#load(cwd)
    this.#cache.set(cwd, { loadedAt: Date.now(), resources })
    resources.catch(() => this.#cache.delete(cwd))
    return resources
  }

  async #load(cwd: string): Promise<PiResources> {
    const settingsManager = SettingsManager.create(cwd, this.#agentDir)
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.#agentDir,
      settingsManager,
      noExtensions: true,
      noThemes: true,
    })
    // Pico opens a project on the user's request, and loads no extensions, so
    // its project skills, prompts, and context files are trusted.
    await loader.reload({ resolveProjectTrust: async () => true })
    return {
      skills: loader.getSkills().skills,
      prompts: loader.getPrompts().prompts,
      agentsFiles: loader.getAgentsFiles().agentsFiles,
      appendSystemPrompt: loader.getAppendSystemPrompt(),
      customSystemPrompt: loader.getSystemPrompt(),
    }
  }
}

function stripFrontmatter(content: string) {
  if (!content.startsWith("---")) return content
  const end = content.indexOf("\n---", 3)
  if (end < 0) return content
  return content.slice(content.indexOf("\n", end + 4) + 1)
}

/** Expand `/skill:name args` to the skill's content, as Pi does. */
export function expandSkillCommand(text: string, skills: readonly Skill[]): string {
  if (!text.startsWith("/skill:")) return text
  const space = text.indexOf(" ")
  const name = space === -1 ? text.slice(7) : text.slice(7, space)
  const args = space === -1 ? "" : text.slice(space + 1).trim()
  const skill = skills.find((candidate) => candidate.name === name)
  if (!skill) return text
  try {
    const body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim()
    const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
    return args ? `${block}\n\n${args}` : block
  } catch {
    return text
  }
}

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: string | null = null
  for (const char of argsString) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }
  if (current) args.push(current)
  return args
}

function substituteArgs(content: string, args: string[]) {
  const all = args.join(" ")
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (
      _match,
      defaultTarget: string | undefined,
      defaultValue: string | undefined,
      sliceStart: string | undefined,
      sliceLength: string | undefined,
      simple: string | undefined
    ) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? all
            : args[Number.parseInt(defaultTarget, 10) - 1]
        return value ? value : (defaultValue ?? "")
      }
      if (sliceStart) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1)
        if (sliceLength) {
          return args.slice(start, start + Number.parseInt(sliceLength, 10)).join(" ")
        }
        return args.slice(start).join(" ")
      }
      if (simple === "ARGUMENTS" || simple === "@") return all
      return args[Number.parseInt(simple ?? "0", 10) - 1] ?? ""
    }
  )
}

/** Expand `/template args` with a prompt template, as Pi does. */
export function expandPromptTemplate(text: string, templates: readonly PromptTemplate[]): string {
  if (!text.startsWith("/")) return text
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) return text
  const template = templates.find((candidate) => candidate.name === match[1])
  if (!template) return text
  return substituteArgs(template.content, parseCommandArgs(match[2] ?? ""))
}
