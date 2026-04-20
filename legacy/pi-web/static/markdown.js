import { marked } from "./vendor/marked.esm.js"
import DOMPurify from "./vendor/purify.es.js"
import {
  normalizeHighlightLanguage,
  queueSyntaxHighlight,
} from "./highlight.js"

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style", "script"],
  FORBID_CONTENTS: ["style", "script"],
}

marked.setOptions({
  gfm: true,
  breaks: false,
})

marked.use({
  renderer: {
    image(token) {
      return escapeHtml(token?.text || "image")
    },
  },
})

export function renderMarkdownContent(text, className = "markdown-block") {
  const container = document.createElement("div")
  container.className = className

  const source = String(text || "")
  if (!source) {
    return container
  }

  try {
    const rendered = marked.parse(source)
    const html =
      typeof rendered === "string" ? rendered : String(rendered || "")
    if (!html || !DOMPurify.isSupported) {
      appendPlainText(container, source)
      return container
    }

    container.innerHTML = DOMPurify.sanitize(html, SANITIZE_CONFIG)
    enhanceMarkdown(container)
  } catch {
    appendPlainText(container, source)
  }

  return container
}

function enhanceMarkdown(container) {
  enhanceLinks(container)
  enhanceCodeBlocks(container)
}

function enhanceLinks(container) {
  for (const link of container.querySelectorAll("a[href]")) {
    link.target = "_blank"
    link.rel = "noopener noreferrer"
  }
}

function enhanceCodeBlocks(container) {
  const blocks = Array.from(container.querySelectorAll("pre > code"))
  for (const code of blocks) {
    const pre = code.parentElement
    if (!(pre instanceof HTMLElement)) continue
    if (pre.parentElement?.classList.contains("markdown-code-block")) continue

    const language = extractCodeLanguage(code)
    if (language) {
      code.dataset.language = language
    }

    const wrap = document.createElement("div")
    wrap.className = "markdown-code-block"

    const toolbar = document.createElement("div")
    toolbar.className = "markdown-code-block-toolbar"

    const languageLabel = document.createElement("span")
    languageLabel.className = "markdown-code-block-language"
    languageLabel.textContent = language || ""
    if (!language) {
      languageLabel.setAttribute("aria-hidden", "true")
    }
    toolbar.appendChild(languageLabel)

    const copyButton = document.createElement("button")
    copyButton.type = "button"
    copyButton.className = "markdown-code-block-copy"
    copyButton.title = "Copy code"
    copyButton.setAttribute("aria-label", "Copy code to clipboard")
    setCopyState(copyButton, "idle")
    copyButton.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(
        code.textContent || "",
        copyButton
      )
      setCopyState(copyButton, copied ? "copied" : "error")
    })
    toolbar.appendChild(copyButton)

    pre.replaceWith(wrap)
    wrap.appendChild(toolbar)
    wrap.appendChild(pre)

    if (language) {
      queueSyntaxHighlight(code, code.textContent || "", language)
    }
  }
}

function extractCodeLanguage(code) {
  const dataLanguage =
    typeof code.dataset.language === "string"
      ? code.dataset.language.trim()
      : ""
  if (dataLanguage) {
    return normalizeHighlightLanguage(dataLanguage.split(/\s+/, 1)[0])
  }

  for (const token of code.classList) {
    if (!token.startsWith("language-")) continue
    const language = token.slice("language-".length).trim()
    if (!language) continue
    return normalizeHighlightLanguage(language.split(/\s+/, 1)[0])
  }

  return ""
}

function setCopyState(button, state) {
  button.dataset.copyState = state
  button.textContent =
    state === "copied" ? "Copied" : state === "error" ? "Failed" : "Copy"

  window.clearTimeout(button._copyResetTimer)
  if (state !== "idle") {
    button._copyResetTimer = window.setTimeout(() => {
      button.dataset.copyState = "idle"
      button.textContent = "Copy"
    }, 1800)
  }
}

async function copyTextToClipboard(text, restoreFocusEl) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall back to execCommand below.
    }
  }

  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    return false
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
    if (restoreFocusEl?.isConnected) {
      try {
        restoreFocusEl.focus({ preventScroll: true })
      } catch {
        restoreFocusEl.focus()
      }
    }
  }
}

function appendPlainText(container, source) {
  const text = String(source || "").replace(/\r\n?/g, "\n")
  const paragraphs = text.split(/\n\n+/).filter((part) => part.length > 0)

  if (paragraphs.length === 0) {
    return
  }

  for (const paragraphText of paragraphs) {
    const paragraph = document.createElement("p")
    const lines = paragraphText.split("\n")
    lines.forEach((line, index) => {
      if (index > 0) {
        paragraph.appendChild(document.createElement("br"))
      }
      paragraph.appendChild(document.createTextNode(line))
    })
    container.appendChild(paragraph)
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
