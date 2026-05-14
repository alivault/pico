import { highlight as sugarHigh } from "sugar-high"
import {
  c as sugarC,
  css as sugarCss,
  go as sugarGo,
  java as sugarJava,
  python as sugarPython,
  rust as sugarRust,
} from "sugar-high/presets"

export type HighlightPayload =
  | {
      language?: string
      html: string
    }
  | {
      skipped: true
      language?: string
    }
  | {
      unsupported: true
      language?: string
    }
  | {
      unavailable: true
    }

type SugarHighOptions = Parameters<typeof sugarHigh>[1]

function normalizeHighlightLanguage(language: unknown) {
  const normalized =
    typeof language === "string"
      ? language
          .trim()
          .toLowerCase()
          .replace(/^language-/, "")
      : ""
  if (!normalized) return ""

  switch (normalized) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "ts":
      return "typescript"
    case "py":
      return "python"
    case "rs":
      return "rust"
    case "golang":
      return "go"
    case "htm":
    case "xhtml":
      return "html"
    case "yml":
      return "yaml"
    case "shell":
    case "shellscript":
    case "sh":
    case "zsh":
      return "bash"
    case "plain":
    case "text":
      return "plaintext"
    case "h":
      return "c"
    default:
      return normalized
  }
}

function countTextLines(text: string) {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  return lines
}

function getSugarHighOptions(
  language: string
): SugarHighOptions | null | undefined {
  switch (language) {
    case "javascript":
    case "jsx":
    case "typescript":
    case "tsx":
    case "json":
    case "jsonc":
    case "html":
    case "xml":
    case "svg":
    case "mdx":
      return null
    case "css":
      return sugarCss
    case "python":
      return sugarPython
    case "rust":
      return sugarRust
    case "c":
      return sugarC
    case "go":
      return sugarGo
    case "java":
      return sugarJava
    default:
      return undefined
  }
}

export function buildHighlightPayload(options: {
  code: unknown
  language: unknown
}):
  | { skipped: true; language?: string }
  | { language: string; html: string }
  | { unsupported: true; language: string } {
  const text = typeof options.code === "string" ? options.code : ""
  const normalizedLanguage = normalizeHighlightLanguage(options.language)

  if (!text || !normalizedLanguage) {
    return {
      skipped: true,
      language: normalizedLanguage || undefined,
    }
  }

  if (
    normalizedLanguage === "plaintext" ||
    text.length > 100_000 ||
    countTextLines(text) > 1_500
  ) {
    return {
      skipped: true,
      language: normalizedLanguage,
    }
  }

  const sugarOptions = getSugarHighOptions(normalizedLanguage)
  if (sugarOptions === undefined) {
    return {
      unsupported: true,
      language: normalizedLanguage,
    }
  }

  return {
    language: normalizedLanguage,
    html: sugarHigh(text, sugarOptions ?? undefined),
  }
}
