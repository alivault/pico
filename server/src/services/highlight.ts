/**
 * Syntax highlighting for code blocks and file previews, with Shiki. The
 * output is lines of spans colored with `--sh-token-*` CSS variables, which
 * the client's themes define.
 */
import {
  bundledLanguages,
  createCssVariablesTheme,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki"

const MAX_CODE_UTF16_UNITS = 100_000
const MAX_CODE_LINES = 1500
const CACHE_MAX_ENTRIES = 512

const theme = createCssVariablesTheme({ name: "pico-variables", variablePrefix: "--sh-", fontStyle: true })

const ALIASES: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  cts: "typescript",
  mts: "typescript",
  golang: "go",
  htm: "html",
  xhtml: "html",
  svg: "xml",
  shell: "bash",
  shellscript: "bash",
  plain: "text",
  txt: "text",
  h: "c",
  plist: "xml",
  dotenv: "dotenv",
  gitignore: "text",
  ignore: "text",
}

function normalizeLanguage(language: string) {
  const lower = language.trim().toLowerCase().replace(/^language-/, "")
  return ALIASES[lower] ?? lower
}

export type HighlightOutcome =
  | { language: string; html: string }
  | { skipped: true; language?: string }
  | { unsupported: true; language: string }
  | { unavailable: true }

export class HighlightService {
  #highlighter: Promise<Highlighter> | undefined
  readonly #cache = new Map<string, HighlightOutcome>()

  #instance() {
    this.#highlighter ??= createHighlighter({ themes: [theme], langs: [] })
    return this.#highlighter
  }

  async highlight(code: unknown, language: unknown): Promise<HighlightOutcome> {
    const text = typeof code === "string" ? code : ""
    const normalized = normalizeLanguage(typeof language === "string" ? language : "")
    if (!text || !normalized) return { skipped: true, ...(normalized ? { language: normalized } : {}) }
    if (normalized === "text" || normalized === "plaintext" || text.length > MAX_CODE_UTF16_UNITS || text.split("\n").length > MAX_CODE_LINES) {
      return { skipped: true, language: normalized }
    }
    const key = `${normalized}\0${text}`
    const cached = this.#cache.get(key)
    if (cached) {
      this.#cache.delete(key)
      this.#cache.set(key, cached)
      return cached
    }
    if (!(normalized in bundledLanguages)) return { unsupported: true, language: normalized }
    let outcome: HighlightOutcome
    try {
      const highlighter = await this.#instance()
      if (!highlighter.getLoadedLanguages().includes(normalized)) {
        await highlighter.loadLanguage(normalized as BundledLanguage)
      }
      const html = highlighter.codeToHtml(text, { lang: normalized, theme: "pico-variables" })
      outcome = { language: normalized, html: lines(html) }
    } catch (error) {
      console.warn("[pico] highlighting failed:", error)
      return { unavailable: true }
    }
    this.#cache.set(key, outcome)
    while (this.#cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.#cache.keys().next().value
      if (oldest === undefined) break
      this.#cache.delete(oldest)
    }
    return outcome
  }
}

/** Keep the line spans; drop Shiki's `<pre>` and `<code>` wrapper. */
function lines(html: string) {
  const start = html.indexOf("<code>")
  const end = html.lastIndexOf("</code>")
  return start >= 0 && end > start ? html.slice(start + "<code>".length, end) : html
}
