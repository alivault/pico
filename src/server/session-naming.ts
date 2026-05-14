import { basename } from "node:path"

import { loadPiAi } from "@/server/pi-sdk"
import type { ModelRegistryLike } from "@/server/pi-sdk-types"

const MAX_SESSION_NAME_LENGTH = 48
const MAX_SESSION_NAME_WORDS = 6
const MAX_SESSION_NAME_PROMPT_CHARS = 1600
const IMAGE_ONLY_SESSION_NAME = "Image task"
const SESSION_NAME_SYSTEM_PROMPT = `You write short session names for coding-agent browser sessions.

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

function stripLeadingFiller(text: string) {
  const patterns = [
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

  let current = text.trim()
  let changed = true

  while (changed) {
    changed = false
    for (const pattern of patterns) {
      const next = current.replace(pattern, "").trim()
      if (next && next !== current) {
        current = next
        changed = true
      }
    }
  }

  return current
}

function truncateSessionName(
  text: string,
  maxLength = MAX_SESSION_NAME_LENGTH
) {
  if (text.length <= maxLength) return text

  const slice = text.slice(0, Math.max(0, maxLength - 1))
  const lastSpace = slice.lastIndexOf(" ")
  const cutoff =
    lastSpace >= Math.floor(maxLength * 0.6) ? slice.slice(0, lastSpace) : slice
  return `${cutoff.trimEnd()}…`
}

function stripTrailingStopWords(text: string) {
  const trailingWords = new Set([
    "a",
    "an",
    "and",
    "for",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
  ])
  const words = text.split(" ")
  while (
    words.length > 2 &&
    trailingWords.has(words[words.length - 1]?.toLowerCase() ?? "")
  ) {
    words.pop()
  }
  return words.join(" ")
}

function stringifyNameCandidate(raw: unknown) {
  if (typeof raw === "string") return raw
  if (
    typeof raw === "number" ||
    typeof raw === "boolean" ||
    typeof raw === "bigint"
  ) {
    return String(raw)
  }

  try {
    return JSON.stringify(raw) ?? ""
  } catch {
    return ""
  }
}

export function cleanupSessionNameCandidate(raw: unknown) {
  if (!raw) return undefined

  const rawText = stringifyNameCandidate(raw)
  let text = rawText.split(/\r?\n/).find((line) => line.trim()) ?? rawText
  text = text.replace(/^[\s>*`"'#[\]-]+/, "")
  text = text.replace(/^(title|session title|name)\s*:\s*/i, "")
  text = normalizeWhitespace(text)
  text = stripLeadingFiller(text)
  text = trimTrailingPunctuation(text)

  if (!text) return undefined

  const words = text.split(" ")
  if (words.length > MAX_SESSION_NAME_WORDS) {
    text = words.slice(0, MAX_SESSION_NAME_WORDS).join(" ")
  }

  text = stripTrailingStopWords(text)
  text = truncateSessionName(text)
  const ellipsis = text.endsWith("…") ? "…" : ""
  const baseText = stripTrailingStopWords(text.replace(/…$/, "")).trim()
  text = baseText ? `${baseText}${ellipsis}` : baseText
  return text || undefined
}

function simplifyPromptForSessionName(text: string) {
  return normalizeWhitespace(
    text
      .replace(/```[\s\S]*?```/g, " code ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/[#>*_~]/g, " ")
  )
}

export function deriveHeuristicSessionNameAttempt(
  text: string,
  imageCount: number
) {
  const simplified = simplifyPromptForSessionName(text)
  if (!simplified) {
    return imageCount > 0
      ? { name: IMAGE_ONLY_SESSION_NAME }
      : { reason: "first prompt had no text content" }
  }

  const firstClause = simplified.split(/[\n.!?]/, 1)[0] ?? simplified
  const stripped = stripLeadingFiller(firstClause) || simplified
  const candidate = cleanupSessionNameCandidate(stripped)
  if (candidate) {
    return { name: candidate }
  }

  if (imageCount > 0) {
    return { name: IMAGE_ONLY_SESSION_NAME }
  }

  return {
    reason: "first prompt did not contain a usable title after cleanup",
  }
}

export function summarizePromptContent(content: unknown) {
  if (typeof content === "string") {
    return { text: content, imageCount: 0 }
  }

  if (!Array.isArray(content)) {
    return { text: "", imageCount: 0 }
  }

  let imageCount = 0
  const text = content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      if (
        (block as { type?: unknown; text?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text
      }
      if ((block as { type?: unknown }).type === "image") {
        imageCount += 1
      }
      return ""
    })
    .join(" ")

  return { text, imageCount }
}

function buildSessionNamePrompt(
  prompt: string,
  cwdBasename: string,
  imageCount: number
) {
  const normalizedPrompt = normalizeWhitespace(prompt).slice(
    0,
    MAX_SESSION_NAME_PROMPT_CHARS
  )

  return [
    `Current folder: ${cwdBasename || "unknown"}`,
    imageCount > 0 ? `Attached images: ${imageCount}` : "",
    "",
    "First user prompt:",
    normalizedPrompt,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function generateSessionNameWithLlm(
  entry: {
    cwd: string
    services: {
      modelRegistry: ModelRegistryLike
    }
  },
  text: string,
  imageCount: number
) {
  const model = entry.services.modelRegistry.find(
    "openai-codex",
    "gpt-5.4-mini"
  )
  if (!model) {
    return {
      reason: "refinement model openai-codex/gpt-5.4-mini is unavailable",
    }
  }

  const auth = await entry.services.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth?.ok) {
    return {
      reason:
        auth?.error ||
        `failed to authenticate ${model.provider}/${model.id} for session naming`,
    }
  }

  const piAi = await loadPiAi()
  const response = await piAi.complete(
    model,
    {
      systemPrompt: SESSION_NAME_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildSessionNamePrompt(
                text,
                basename(entry.cwd),
                imageCount
              ),
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      reasoningEffort: "minimal",
    }
  )

  const raw = Array.isArray(response?.content)
    ? response.content
        .flatMap((block) =>
          block?.type === "text" && typeof block.text === "string"
            ? [block.text]
            : []
        )
        .join(" ")
    : ""

  if (!raw.trim()) {
    return {
      reason: `refinement model ${model.provider}/${model.id} returned no text`,
    }
  }

  const cleaned = cleanupSessionNameCandidate(raw)
  if (!cleaned) {
    return {
      reason: `refinement model ${model.provider}/${model.id} returned no usable title`,
    }
  }

  return { name: cleaned }
}
