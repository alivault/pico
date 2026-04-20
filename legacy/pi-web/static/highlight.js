const HIGHLIGHT_LANGUAGE_ALIASES = new Map([
  ["shellscript", "bash"],
  ["plain", "plaintext"],
  ["text", "plaintext"],
  ["c++", "cpp"],
  ["c#", "csharp"],
  ["objective-c", "objectivec"],
])

const PLAIN_TEXT_LANGUAGES = new Set(["plaintext"])
const MAX_HIGHLIGHT_TEXT_LENGTH = 100_000
const MAX_HIGHLIGHT_LINE_COUNT = 1_500
const MAX_CONCURRENT_HIGHLIGHT_REQUESTS = 2

const highlightResponseCache = new Map()
const pendingHighlightTasks = []
let activeHighlightRequests = 0
let highlightDrainScheduled = false

export function normalizeHighlightLanguage(value) {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/^language-/, "")
      : ""
  if (!normalized) return ""
  return HIGHLIGHT_LANGUAGE_ALIASES.get(normalized) || normalized
}

export function queueSyntaxHighlight(codeElement, codeText, language) {
  const normalizedLanguage = normalizeHighlightLanguage(language)
  if (
    !codeElement ||
    !normalizedLanguage ||
    PLAIN_TEXT_LANGUAGES.has(normalizedLanguage)
  )
    return
  if (
    typeof codeText !== "string" ||
    codeText.length > MAX_HIGHLIGHT_TEXT_LENGTH ||
    countTextLines(codeText) > MAX_HIGHLIGHT_LINE_COUNT
  ) {
    return
  }
  if (codeElement._syntaxHighlightQueued) return

  codeElement._syntaxHighlightQueued = true
  codeElement._syntaxHighlightLanguage = normalizedLanguage
  pendingHighlightTasks.push({
    codeElement,
    codeText,
    language: normalizedLanguage,
  })
  codeElement
    .closest(".markdown-code-block")
    ?.classList.add("is-highlight-pending")
  scheduleHighlightDrain()
}

function scheduleHighlightDrain() {
  if (highlightDrainScheduled) return
  highlightDrainScheduled = true
  scheduleIdleTask(() => {
    highlightDrainScheduled = false
    drainHighlightQueue()
  })
}

function scheduleIdleTask(callback) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout: 250 })
    return
  }
  window.setTimeout(callback, 32)
}

function drainHighlightQueue() {
  while (
    activeHighlightRequests < MAX_CONCURRENT_HIGHLIGHT_REQUESTS &&
    pendingHighlightTasks.length > 0
  ) {
    const task = pendingHighlightTasks.shift()
    if (!task?.codeElement) continue
    if (!task.codeElement.isConnected) {
      finishHighlightTask(task.codeElement)
      continue
    }

    activeHighlightRequests += 1
    void performSyntaxHighlight(task).finally(() => {
      activeHighlightRequests -= 1
      if (pendingHighlightTasks.length > 0) {
        scheduleHighlightDrain()
      }
    })
  }
}

async function performSyntaxHighlight(task) {
  const { codeElement, codeText, language } = task
  try {
    const result = await fetchHighlightedHtml(codeText, language)
    if (
      !result?.html ||
      !codeElement.isConnected ||
      codeElement._syntaxHighlightLanguage !== language
    ) {
      return
    }

    codeElement.innerHTML = result.html
    codeElement.classList.add("hljs")
    const classToken = sanitizeClassToken(result.language || language)
    if (classToken) {
      codeElement.classList.add(`language-${classToken}`)
    }
    codeElement.closest(".markdown-code-block")?.classList.add("is-highlighted")
  } catch {
    // Leave the plain-text code block in place.
  } finally {
    finishHighlightTask(codeElement)
  }
}

function finishHighlightTask(codeElement) {
  if (!codeElement) return
  codeElement._syntaxHighlightQueued = false
  codeElement
    .closest(".markdown-code-block")
    ?.classList.remove("is-highlight-pending")
}

async function fetchHighlightedHtml(codeText, language) {
  const cacheKey = `${language}\u0000${codeText}`
  if (highlightResponseCache.has(cacheKey)) {
    return highlightResponseCache.get(cacheKey)
  }

  const requestPromise = requestHighlightedHtml(codeText, language).catch(
    (error) => {
      highlightResponseCache.delete(cacheKey)
      throw error
    }
  )

  highlightResponseCache.set(cacheKey, requestPromise)
  return requestPromise
}

async function requestHighlightedHtml(codeText, language) {
  const response = await fetch("/api/highlight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: codeText, language }),
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`)
  }

  if (!data?.html) {
    return null
  }

  return {
    html: String(data.html),
    language: typeof data.language === "string" ? data.language : language,
  }
}

function countTextLines(text) {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1
    }
  }
  return lines
}

function sanitizeClassToken(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || ""
}
