/**
 * The durable browser: Chrome through Playwright, one browser context for
 * each conversation.
 *
 * Cookies and local storage go to `<data>/browser/<conversation>.json` after
 * each action, and the open tabs to the conversation's `pico.browser`
 * document (see the browser extension). After a restart, a context is made
 * again from that file and the tabs open again at their URLs.
 *
 * Pages are read through a list of the visible interactive elements, each
 * with a number (`ref`) that actions use.
 *
 * A context that no tool used for `IDLE_MS` closes (its cookies are saved
 * first; a visible Chrome waits `HEADED_IDLE_MS`, as the user may use its
 * window, for example to log in), and Chrome closes when no context remains. The next tool call
 * opens them again.
 */
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { delimiter, join } from "node:path"

import type { Browser, BrowserContext, Page } from "playwright-core"

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
]

/** Names to look up in PATH, for systems such as NixOS without /usr/bin. */
const CHROME_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "brave",
  "microsoft-edge",
]

// A file, not `existsSync`: in some sandboxes access() passes for a path
// that does not exist.
function isFile(path: string) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
}

export function findChrome() {
  const explicit = process.env.PICO_BROWSER_PATH?.trim()
  if (explicit) return explicit
  const found = CHROME_PATHS.find(isFile)
  if (found) return found
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const command of CHROME_COMMANDS) {
    for (const dir of dirs) {
      const path = join(dir, command)
      if (isFile(path)) return path
    }
  }
  return undefined
}

/** Close a conversation's context after this long without use. */
const IDLE_MS = 10 * 60 * 1000
/** The idle time when Chrome is visible. */
const HEADED_IDLE_MS = 60 * 60 * 1000

export type BrowserTab = { id: string; url: string; title: string }

/** A request of the agent for the user to use its browser. */
export type BrowserHandoff = { questionId: string; reason: string }

type Session = {
  context: BrowserContext
  pages: Map<string, Page>
  active?: string
  nextTab: number
}

/** The script that numbers interactive elements and describes them. */
const SNAPSHOT_SCRIPT = `(() => {
  const selector = 'a[href], button, input, select, textarea, summary, [role], [onclick], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  const visible = (element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    const style = getComputedStyle(element)
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0
  }
  const name = (element) => {
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.getAttribute("alt") || ""
    if (label) return label
    if (element.id) {
      const forLabel = document.querySelector('label[for="' + CSS.escape(element.id) + '"]')
      if (forLabel) return forLabel.innerText
    }
    return (element.innerText || element.value || "").toString()
  }
  document.querySelectorAll("[data-pico-ref]").forEach((element) => element.removeAttribute("data-pico-ref"))
  const lines = []
  let ref = 0
  for (const element of document.querySelectorAll(selector)) {
    if (!visible(element) || lines.length >= 300) continue
    ref += 1
    element.setAttribute("data-pico-ref", String(ref))
    const tag = element.tagName.toLowerCase()
    const role = element.getAttribute("role") || (tag === "a" ? "link" : tag === "input" ? "input:" + (element.type || "text") : tag)
    const text = name(element).replace(/\\s+/g, " ").trim().slice(0, 80)
    const extras = []
    if (tag === "a" && element.getAttribute("href")) extras.push("href=" + element.getAttribute("href").slice(0, 80))
    if ("value" in element && element.value && tag !== "button") extras.push("value=" + JSON.stringify(String(element.value).slice(0, 40)))
    if (element.checked) extras.push("checked")
    if (element.disabled) extras.push("disabled")
    lines.push("[" + ref + "] " + role + (text ? ' "' + text + '"' : "") + (extras.length ? " " + extras.join(" ") : ""))
  }
  const headings = [...document.querySelectorAll("h1, h2, h3")].filter(visible).slice(0, 20).map((element) => element.tagName.toLowerCase() + ": " + element.innerText.replace(/\\s+/g, " ").trim().slice(0, 100))
  const text = (document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 4000)
  return { headings, elements: lines, text }
})()`

export type PageSnapshot = {
  url: string
  title: string
  headings: string[]
  elements: string[]
  text: string
}

export class BrowserManager {
  readonly #dataDir: string
  readonly #headless: () => boolean
  #browser: Promise<Browser> | undefined
  #current: Browser | undefined
  readonly #sessions = new Map<number, Promise<Session>>()
  readonly #lastUsed = new Map<number, number>()
  readonly #idleMs: number | undefined
  /** Whether the running Chrome is visible. */
  #headed = false
  readonly #reaper: NodeJS.Timeout
  /** Listeners for changes of a conversation's tabs (the live view). */
  readonly #listeners = new Map<number, Set<() => void>>()
  /** Open handoffs: their contexts do not close when idle. */
  readonly #handoffs = new Map<number, BrowserHandoff>()

  constructor(
    dataDir: string,
    headless: () => boolean,
    options: { idleMs?: number } = {}
  ) {
    this.#dataDir = dataDir
    this.#headless = headless
    this.#idleMs = options.idleMs
    this.#reaper = setInterval(
      () => void this.closeIdle(),
      Math.min(60_000, this.#idleMs ?? IDLE_MS)
    )
    this.#reaper.unref()
  }

  #touch(conversationId: number) {
    this.#lastUsed.set(conversationId, Date.now())
  }

  /** Mark a conversation's browser as used, for example by the user. */
  touch(conversationId: number) {
    if (this.#sessions.has(conversationId)) this.#touch(conversationId)
  }

  /**
   * Call `listener` when a conversation's context opens or closes, or its
   * tabs change: a new tab, a closed tab, another active tab, or a new page
   * in a tab. Returns a function that stops it.
   */
  watch(conversationId: number, listener: () => void) {
    let listeners = this.#listeners.get(conversationId)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(conversationId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(conversationId)
    }
  }

  #emit(conversationId: number) {
    for (const listener of this.#listeners.get(conversationId) ?? []) {
      try {
        listener()
      } catch {
        // A listener must not stop the others.
      }
    }
  }

  /** Whether a conversation has an open context. */
  isOpen(conversationId: number) {
    return this.#sessions.has(conversationId)
  }

  /** The open handoff of a conversation. */
  handoff(conversationId: number) {
    return this.#handoffs.get(conversationId)
  }

  /**
   * Start a handoff: the user uses the browser. The context stays open
   * until the returned function ends the handoff.
   */
  startHandoff(conversationId: number, handoff: BrowserHandoff) {
    this.#handoffs.set(conversationId, handoff)
    this.#emit(conversationId)
    return () => {
      if (this.#handoffs.get(conversationId) !== handoff) return
      this.#handoffs.delete(conversationId)
      this.#touch(conversationId)
      this.#emit(conversationId)
    }
  }

  /** The active tab of an open context, without opening one. */
  async activePage(conversationId: number) {
    const session = await this.#sessions
      .get(conversationId)
      ?.catch(() => undefined)
    const id = session?.active
    const page = id ? session.pages.get(id) : undefined
    return id && page && !page.isClosed() ? { id, page } : undefined
  }

  /** Keep the tabs of a context in step with its pages, and tell watchers. */
  #track(conversationId: number, session: Session, id: string, page: Page) {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.#emit(conversationId)
    })
    page.on("load", () => this.#emit(conversationId))
    page.on("close", () => {
      if (session.pages.get(id) !== page) return
      session.pages.delete(id)
      if (session.active === id)
        session.active = [...session.pages.keys()].at(-1)
      this.#emit(conversationId)
    })
  }

  #addPage(conversationId: number, session: Session, page: Page) {
    const id = `t${session.nextTab++}`
    session.pages.set(id, page)
    this.#track(conversationId, session, id, page)
    return id
  }

  /** The number of open contexts, and whether Chrome runs. */
  get stats() {
    return { contexts: this.#sessions.size, running: Boolean(this.#browser) }
  }

  /**
   * Close the contexts that no tool used for the idle time, then Chrome when
   * no context remains.
   */
  async closeIdle(now = Date.now(), idleOverrideMs?: number) {
    for (const id of this.#sessions.keys()) {
      const idleMs =
        idleOverrideMs ??
        this.#idleMs ??
        (this.#headed ? HEADED_IDLE_MS : IDLE_MS)
      if (now - (this.#lastUsed.get(id) ?? 0) < idleMs) continue
      if (this.#handoffs.has(id)) continue
      await this.closeSession(id).catch(() => undefined)
    }
    if (this.#sessions.size > 0 || !this.#browser) return
    const browser = await this.#browser.catch(() => undefined)
    // A tool can open a context while this waits.
    if (this.#sessions.size > 0) return
    this.#browser = undefined
    if (this.#current === browser) this.#current = undefined
    await browser?.close().catch(() => undefined)
  }

  #statePath(conversationId: number) {
    return join(this.#dataDir, "browser", `${conversationId}.json`)
  }

  async #launch() {
    const executablePath = findChrome()
    if (!executablePath)
      throw new Error(
        "No Chrome, Chromium, Brave, or Edge found. Install Chrome, or set PICO_BROWSER_PATH."
      )
    const { chromium } = await import("playwright-core")
    const headless = this.#headless()
    const browser = await chromium.launch({
      executablePath,
      headless,
      args: ["--no-first-run", "--no-default-browser-check"],
    })
    this.#current = browser
    this.#headed = !headless
    browser.on("disconnected", () => {
      // An old Chrome that closed while idle: a new one may run already.
      if (this.#current !== browser) return
      this.#current = undefined
      this.#browser = undefined
      const ids = [...this.#sessions.keys()]
      this.#sessions.clear()
      this.#lastUsed.clear()
      for (const id of ids) this.#emit(id)
    })
    return browser
  }

  async #browserInstance() {
    this.#browser ??= this.#launch().catch((error: unknown) => {
      this.#browser = undefined
      throw error
    })
    return this.#browser
  }

  /** The context of a conversation; reopens saved tabs after a restart. */
  async session(conversationId: number, tabs: BrowserTab[] = []) {
    this.#touch(conversationId)
    let session = this.#sessions.get(conversationId)
    if (!session) {
      session = (async () => {
        const browser = await this.#browserInstance()
        const statePath = this.#statePath(conversationId)
        const storageState = existsSync(statePath)
          ? (JSON.parse(await readFile(statePath, "utf8")) as never)
          : undefined
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          ...(storageState ? { storageState } : {}),
        })
        const created: Session = { context, pages: new Map(), nextTab: 1 }
        for (const tab of tabs) {
          const page = await context.newPage()
          created.pages.set(tab.id, page)
          this.#track(conversationId, created, tab.id, page)
          created.nextTab = Math.max(
            created.nextTab,
            Number(tab.id.replace(/\D/g, "")) + 1
          )
          await page
            .goto(tab.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
            .catch(() => undefined)
        }
        created.active = tabs.at(-1)?.id
        // A page that a page opens (a popup, a link to a new window) gets a
        // tab, and becomes the active tab. A tab that Pico opens is in the
        // map before this runs.
        context.on("page", (page) => {
          setTimeout(() => {
            if ([...created.pages.values()].includes(page)) return
            if (page.isClosed()) return
            created.active = this.#addPage(conversationId, created, page)
            this.#emit(conversationId)
          }, 0)
        })
        return created
      })().catch((error: unknown) => {
        this.#sessions.delete(conversationId)
        throw error
      })
      this.#sessions.set(conversationId, session)
      void session.then(
        () => this.#emit(conversationId),
        () => undefined
      )
    }
    return session
  }

  async page(conversationId: number, tabs: BrowserTab[]) {
    const session = await this.session(conversationId, tabs)
    const page = session.active ? session.pages.get(session.active) : undefined
    if (!page || page.isClosed())
      throw new Error(
        "No open tab. Open a page with the browser open action first."
      )
    return { session, page }
  }

  async open(
    conversationId: number,
    tabs: BrowserTab[],
    url: string,
    newTab: boolean
  ) {
    const session = await this.session(conversationId, tabs)
    let id = !newTab ? session.active : undefined
    let page = id ? session.pages.get(id) : undefined
    if (!page || page.isClosed()) {
      page = await session.context.newPage()
      id = this.#addPage(conversationId, session, page)
    }
    session.active = id
    this.#emit(conversationId)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
    await page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => undefined)
    return { id: id!, page }
  }

  async snapshot(page: Page): Promise<PageSnapshot> {
    const result = (await page.evaluate(SNAPSHOT_SCRIPT)) as Omit<
      PageSnapshot,
      "url" | "title"
    >
    return { url: page.url(), title: await page.title(), ...result }
  }

  /** The tabs of a conversation, for its document. */
  async tabs(
    conversationId: number
  ): Promise<{ tabs: BrowserTab[]; active?: string }> {
    const session = await this.#sessions.get(conversationId)
    if (!session) return { tabs: [] }
    const tabs: BrowserTab[] = []
    for (const [id, page] of session.pages) {
      if (page.isClosed()) {
        session.pages.delete(id)
        continue
      }
      tabs.push({
        id,
        url: page.url(),
        title: await page.title().catch(() => ""),
      })
    }
    return { tabs, ...(session.active ? { active: session.active } : {}) }
  }

  async switchTab(conversationId: number, id: string) {
    this.#touch(conversationId)
    const session = await this.#sessions.get(conversationId)
    const page = session?.pages.get(id)
    if (!session || !page || page.isClosed()) throw new Error(`No tab ${id}`)
    session.active = id
    await page.bringToFront()
    this.#emit(conversationId)
    return page
  }

  async closeTab(conversationId: number, id: string) {
    this.#touch(conversationId)
    const session = await this.#sessions.get(conversationId)
    const page = session?.pages.get(id)
    if (!session || !page) throw new Error(`No tab ${id}`)
    await page.close()
    session.pages.delete(id)
    if (session.active === id) session.active = [...session.pages.keys()].at(-1)
    this.#emit(conversationId)
  }

  /** Save cookies and local storage of a conversation's context. */
  async persist(conversationId: number) {
    const session = await this.#sessions.get(conversationId)
    if (session) await this.#save(conversationId, session)
  }

  async #save(conversationId: number, session: Session) {
    await mkdir(join(this.#dataDir, "browser"), { recursive: true })
    const state = await session.context.storageState()
    await writeFile(this.#statePath(conversationId), JSON.stringify(state))
  }

  async closeSession(conversationId: number) {
    const pending = this.#sessions.get(conversationId)
    if (!pending) return
    // Out of the map first, so a tool that comes now opens a new context.
    this.#sessions.delete(conversationId)
    this.#lastUsed.delete(conversationId)
    const session = await pending.catch(() => undefined)
    if (!session) return
    await this.#save(conversationId, session).catch(() => undefined)
    await session.context.close().catch(() => undefined)
    this.#emit(conversationId)
  }

  async shutdown() {
    clearInterval(this.#reaper)
    for (const id of this.#sessions.keys())
      await this.persist(id).catch(() => undefined)
    this.#sessions.clear()
    const browser = await this.#browser?.catch(() => undefined)
    this.#browser = undefined
    await browser?.close().catch(() => undefined)
  }
}

export function formatSnapshot(snapshot: PageSnapshot, maxElements = 150) {
  return [
    `${snapshot.title || "(no title)"} — ${snapshot.url}`,
    snapshot.headings.length
      ? `Headings:\n${snapshot.headings.join("\n")}`
      : "",
    `Interactive elements (use ref with the browser actions):\n${snapshot.elements.slice(0, maxElements).join("\n") || "(none)"}${snapshot.elements.length > maxElements ? `\n…and ${snapshot.elements.length - maxElements} more` : ""}`,
    `Text:\n${snapshot.text}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
