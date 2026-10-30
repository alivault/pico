/**
 * Automatic agent names, ported from the `auto-session-name` Pi extension.
 *
 * When the first prompt of an unnamed agent arrives, the agent gets a
 * heuristic name at once. The agent's own model then refines it in the
 * background. A name the user set is never replaced. `generate()` also serves
 * the "generate name" request, Pi's `/auto-name` command.
 */
import { basename } from "node:path"

import type { Api, Model, Models } from "@earendil-works/pi-ai"

const MAX_AGENT_NAME_LENGTH = 48
const MAX_AGENT_NAME_WORDS = 6
const MAX_PROMPT_CHARS = 1600
const GENERATION_TIMEOUT_MS = 30_000
const IMAGE_ONLY_NAME = "Image task"
const TITLE_SYSTEM_PROMPT = `You write short agent names for coding-agent terminal tabs.

Return only the title text.

Rules:
- 2 to 6 words.
- Prefer under 48 characters.
- No quotes, markdown, bullets, emoji, or trailing punctuation.
- Be concrete and task-focused.
- Favor libraries, frameworks, files, APIs, errors, and user intent.
- Drop filler such as "please", "help", "can you", and "I need to".
- Avoid repeating the current folder name unless it is essential.
- If the prompt is mostly logs or code, infer the likely task from the important nouns and errors.`

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function trimTrailingPunctuation(text: string) {
  return text.replace(/[.!?…,:;\-–—\s]+$/g, "").trim()
}

const FILLER_PATTERNS = [
  /^(please\s+)+/i,
  /^(can|could|would|will)\s+you\s+/i,
  /^help\s+me\s+(?:with\s+)?/i,
  /^please\s+help\s+me\s+(?:with\s+)?/i,
  /^i\s+need\s+(?:you\s+)?to\s+/i,
  /^i\s+want\s+(?:you\s+)?to\s+/i,
  /^we\s+need\s+to\s+/i,
  /^let'?s\s+/i,
  /^how\s+do\s+i\s+/i,
  /^how\s+to\s+/i,
  /^what'?s\s+the\s+best\s+way\s+to\s+/i,
]

function stripLeadingFiller(text: string) {
  let current = text.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const pattern of FILLER_PATTERNS) {
      const next = current.replace(pattern, "").trim()
      if (next && next !== current) {
        current = next
        changed = true
      }
    }
  }
  return current
}

function truncateAgentName(
  text: string,
  maxLength = MAX_AGENT_NAME_LENGTH
) {
  if (text.length <= maxLength) return text
  const slice = text.slice(0, Math.max(0, maxLength - 1))
  const lastSpace = slice.lastIndexOf(" ")
  const cutoff =
    lastSpace >= Math.floor(maxLength * 0.6) ? slice.slice(0, lastSpace) : slice
  return `${cutoff.trimEnd()}…`
}

/** Clean a candidate name: first line, no markup or filler, at most six words. */
export function cleanupCandidate(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let text = raw.split(/\r?\n/).find((line) => line.trim()) ?? raw
  text = text.replace(/^[\s>*`"'#[\]-]+/, "")
  text = text.replace(/^(title|session title|name)\s*:\s*/i, "")
  text = text.replace(/^[\s`"'*]+|[\s`"'*]+$/g, "")
  text = normalizeWhitespace(text)
  text = stripLeadingFiller(text)
  text = trimTrailingPunctuation(text)
  if (!text) return undefined
  const words = text.split(" ")
  if (words.length > MAX_AGENT_NAME_WORDS)
    text = words.slice(0, MAX_AGENT_NAME_WORDS).join(" ")
  text = truncateAgentName(text)
  return text || undefined
}

function simplifyPromptForHeuristic(text: string) {
  return normalizeWhitespace(
    text
      .replace(/```[\s\S]*?```/g, " code ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[#>*_~]/g, " ")
  )
}

/** A name from the prompt text alone, available at once. */
export function heuristicAgentName(
  text: string,
  imageCount: number
): string | undefined {
  const simplified = simplifyPromptForHeuristic(text)
  if (!simplified) return imageCount > 0 ? IMAGE_ONLY_NAME : undefined
  const firstClause = simplified.split(/[\n.!?]/, 1)[0] ?? simplified
  const stripped = stripLeadingFiller(firstClause) || simplified
  return (
    cleanupCandidate(stripped) ?? (imageCount > 0 ? IMAGE_ONLY_NAME : undefined)
  )
}

function buildTitlePrompt(prompt: string, cwd: string, imageCount: number) {
  return [
    `Current folder: ${basename(cwd) || "unknown"}`,
    imageCount > 0 ? `Attached images: ${imageCount}` : "",
    "",
    "First user prompt:",
    normalizeWhitespace(prompt).slice(0, MAX_PROMPT_CHARS),
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Ask `model` for a name. Uses the agent's own model: a catalog entry does
 * not guarantee account access, notably with subscriptions.
 */
export async function generateAgentName(
  models: Models,
  model: Model<Api>,
  input: { text: string; imageCount: number; cwd: string },
  signal?: AbortSignal
): Promise<string> {
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await models.completeSimple(
    model,
    {
      systemPrompt: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildTitlePrompt(input.text, input.cwd, input.imageCount),
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    { reasoning: "low", signal: combined }
  )
  // Provider failures usually come back as messages, not as thrown errors.
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(
      response.errorMessage || `Title generation ${response.stopReason}`
    )
  }
  const raw = response.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text"
    )
    .map((block) => block.text)
    .join(" ")
  const name = cleanupCandidate(raw)
  if (!name) throw new Error("Model returned an empty title")
  return name
}
