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
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

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

export function findChrome() {
  const explicit = process.env.PICO_BROWSER_PATH?.trim()
  if (explicit) return explicit
  return CHROME_PATHS.find((path) => existsSync(path))
}

export type BrowserTab = { id: string; url: string; title: string }

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
  readonly #sessions = new Map<number, Promise<Session>>()

  constructor(dataDir: string, headless: () => boolean) {
    this.#dataDir = dataDir
    this.#headless = headless
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
    const browser = await chromium.launch({
      executablePath,
      headless: this.#headless(),
      args: ["--no-first-run", "--no-default-browser-check"],
    })
    browser.on("disconnected", () => {
      this.#browser = undefined
      this.#sessions.clear()
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
          await page
            .goto(tab.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
            .catch(() => undefined)
          created.pages.set(tab.id, page)
          created.nextTab = Math.max(
            created.nextTab,
            Number(tab.id.replace(/\D/g, "")) + 1
          )
        }
        created.active = tabs.at(-1)?.id
        return created
      })().catch((error: unknown) => {
        this.#sessions.delete(conversationId)
        throw error
      })
      this.#sessions.set(conversationId, session)
    }
    return session
  }

  async page(conversationId: number, tabs: BrowserTab[]) {
    const session = await this.session(conversationId, tabs)
    const page = session.active ? session.pages.get(session.active) : undefined
    if (!page || page.isClosed())
      throw new Error("No open tab. Open a page with browser_open first.")
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
      id = `t${session.nextTab++}`
      session.pages.set(id, page)
    }
    session.active = id
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
    const session = await this.#sessions.get(conversationId)
    const page = session?.pages.get(id)
    if (!session || !page || page.isClosed()) throw new Error(`No tab ${id}`)
    session.active = id
    await page.bringToFront()
    return page
  }

  async closeTab(conversationId: number, id: string) {
    const session = await this.#sessions.get(conversationId)
    const page = session?.pages.get(id)
    if (!session || !page) throw new Error(`No tab ${id}`)
    await page.close()
    session.pages.delete(id)
    if (session.active === id) session.active = [...session.pages.keys()].at(-1)
  }

  /** Save cookies and local storage of a conversation's context. */
  async persist(conversationId: number) {
    const session = await this.#sessions.get(conversationId)
    if (!session) return
    await mkdir(join(this.#dataDir, "browser"), { recursive: true })
    const state = await session.context.storageState()
    await writeFile(this.#statePath(conversationId), JSON.stringify(state))
  }

  async closeSession(conversationId: number) {
    const session = await this.#sessions.get(conversationId)
    if (!session) return
    await this.persist(conversationId).catch(() => undefined)
    this.#sessions.delete(conversationId)
    await session.context.close().catch(() => undefined)
  }

  async shutdown() {
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
    `Interactive elements (use ref with browser_act):\n${snapshot.elements.slice(0, maxElements).join("\n") || "(none)"}${snapshot.elements.length > maxElements ? `\n…and ${snapshot.elements.length - maxElements} more` : ""}`,
    `Text:\n${snapshot.text}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
