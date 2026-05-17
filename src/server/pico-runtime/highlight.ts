import {
  bundledLanguages,
  bundledLanguagesAlias,
  codeToHtml,
  createCssVariablesTheme,
} from "shiki"

import { PICO_CODE_SHIKI_THEME, PICO_SHIKI_VARIABLE_DEFAULTS } from "@/lib/pico"

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

const SPECIAL_SHIKI_LANGUAGES = new Set(["ansi", "plain", "plaintext", "text"])
const SUPPORTED_SHIKI_LANGUAGES = new Set([
  ...Object.keys(bundledLanguages),
  ...Object.keys(bundledLanguagesAlias),
])

const picoCodeTheme = createCssVariablesTheme({
  name: PICO_CODE_SHIKI_THEME,
  variablePrefix: "--sh-",
  variableDefaults: { ...PICO_SHIKI_VARIABLE_DEFAULTS },
  fontStyle: false,
})

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
    case "mjs":
    case "cjs":
      return "javascript"
    case "cts":
    case "mts":
      return "typescript"
    case "golang":
      return "go"
    case "htm":
    case "xhtml":
      return "html"
    case "svg":
      return "xml"
    case "shell":
    case "shellscript":
      return "bash"
    case "plain":
    case "txt":
      return "text"
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

function isSupportedShikiLanguage(language: string) {
  return (
    SPECIAL_SHIKI_LANGUAGES.has(language) ||
    SUPPORTED_SHIKI_LANGUAGES.has(language)
  )
}

function shikiCodeInnerHtml(html: string) {
  return /<pre\b[^>]*><code>([\s\S]*)<\/code><\/pre>/.exec(html)?.[1] ?? html
}

export async function buildHighlightPayload(options: {
  code: unknown
  language: unknown
}): Promise<
  | { skipped: true; language?: string }
  | { language: string; html: string }
  | { unsupported: true; language: string }
> {
  const text = typeof options.code === "string" ? options.code : ""
  const normalizedLanguage = normalizeHighlightLanguage(options.language)

  if (!text || !normalizedLanguage) {
    return {
      skipped: true,
      language: normalizedLanguage || undefined,
    }
  }

  if (
    normalizedLanguage === "text" ||
    normalizedLanguage === "plaintext" ||
    text.length > 100_000 ||
    countTextLines(text) > 1_500
  ) {
    return {
      skipped: true,
      language: normalizedLanguage,
    }
  }

  if (!isSupportedShikiLanguage(normalizedLanguage)) {
    return {
      unsupported: true,
      language: normalizedLanguage,
    }
  }

  const html = await codeToHtml(text, {
    lang: normalizedLanguage,
    theme: picoCodeTheme,
    defaultColor: false,
  })

  return {
    language: normalizedLanguage,
    html: shikiCodeInnerHtml(html),
  }
}
