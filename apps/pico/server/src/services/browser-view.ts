/**
 * The live view of an agent's browser, for the Browser tab of the web
 * client. It sends the active tab as JPEG frames (a CDP screencast) and the
 * list of tabs, and it does what the user does in the view: mouse, wheel,
 * keys, text, and navigation. The agent and the user use the same tabs, so
 * a login of the user is also a login of the agent.
 */
import type { CDPSession, Page } from "playwright-core"

import type { BrowserHandoff, BrowserManager, BrowserTab } from "./browser.ts"

/** What the server sends to the view. */
export type BrowserViewEvent =
  | {
      type: "state"
      open: boolean
      tabs: BrowserTab[]
      active?: string
      handoff?: BrowserHandoff
    }
  | {
      type: "frame"
      /** A JPEG image, in base64. */
      data: string
      /** The size of the page's viewport, in CSS pixels. */
      width: number
      height: number
    }
  | { type: "error"; error: string }

/** What the view sends to the server. */
export type BrowserViewInput =
  | {
      type: "mouse"
      action: "move" | "down" | "up"
      x: number
      y: number
      button?: "left" | "right" | "middle"
      clickCount?: number
    }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  /** A key with modifiers, as Playwright names it, for example `Control+a`. */
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "switch_tab"; id: string }
  | { type: "close_tab"; id: string }
  /** Open the context again, with the tabs it had. */
  | { type: "start" }

const NAVIGATION_TIMEOUT_MS = 30_000
const ATTACH_RETRY_MS = 300
const MAX_ATTACH_RETRIES = 10
/** Save the cookies a short time after the user stops. */
const PERSIST_DELAY_MS = 2000

export class BrowserView {
  readonly #browser: BrowserManager
  readonly #conversationId: number
  readonly #savedTabs: () => Promise<BrowserTab[]>
  readonly #send: (event: BrowserViewEvent, done?: () => void) => void
  #stopWatch: (() => void) | undefined
  #page: Page | undefined
  #cdp: CDPSession | undefined
  #stopped = false
  #attachFailures = 0
  #persistTimer: ReturnType<typeof setTimeout> | undefined
  /** One update at a time: tab changes come in bursts. */
  #updating: Promise<void> = Promise.resolve()

  constructor(options: {
    browser: BrowserManager
    conversationId: number
    /** The tabs of the conversation's document, to open them again. */
    savedTabs: () => Promise<BrowserTab[]>
    send: (event: BrowserViewEvent, done?: () => void) => void
  }) {
    this.#browser = options.browser
    this.#conversationId = options.conversationId
    this.#savedTabs = options.savedTabs
    this.#send = options.send
  }

  start() {
    this.#stopWatch = this.#browser.watch(this.#conversationId, () =>
      this.#update()
    )
    this.#update()
  }

  stop() {
    this.#stopped = true
    this.#stopWatch?.()
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer)
      void this.#browser.persist(this.#conversationId).catch(() => undefined)
    }
    void this.#detach()
  }

  #update() {
    this.#updating = this.#updating
      .then(() => this.#refresh())
      .catch((error: unknown) => this.#error(error))
  }

  async #refresh() {
    if (this.#stopped) return
    const conversation = this.#conversationId
    const open = this.#browser.isOpen(conversation)
    const active = open
      ? await this.#browser.activePage(conversation)
      : undefined
    const { tabs, active: activeId } = open
      ? await this.#browser.tabs(conversation)
      : { tabs: await this.#savedTabs().catch(() => []), active: undefined }
    const handoff = this.#browser.handoff(conversation)
    this.#send({
      type: "state",
      open,
      tabs,
      ...(activeId ? { active: activeId } : {}),
      ...(handoff ? { handoff } : {}),
    })
    if (active?.page !== this.#page) {
      await this.#detach()
      if (active) await this.#attachOrRetry(active.page)
    }
  }

  /**
   * A page that navigates while the screencast starts can refuse it ("Not
   * attached to an active page"): try again a short time later.
   */
  async #attachOrRetry(page: Page) {
    try {
      await this.#attach(page)
      this.#attachFailures = 0
    } catch (error) {
      await this.#detach()
      if (this.#stopped || page.isClosed()) return
      if (++this.#attachFailures > MAX_ATTACH_RETRIES) {
        this.#attachFailures = 0
        this.#error(error)
        return
      }
      setTimeout(() => this.#update(), ATTACH_RETRY_MS)
    }
  }

  async #attach(page: Page) {
    if (this.#stopped) return
    this.#page = page
    const cdp = await page.context().newCDPSession(page)
    this.#cdp = cdp
    cdp.on("Page.screencastFrame", (frame) => {
      const ack = () => {
        void cdp
          .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
          .catch(() => undefined)
      }
      if (this.#cdp !== cdp) return
      // The next frame comes after the view got this one, so a slow
      // network gets fewer frames, not a queue.
      this.#send(
        {
          type: "frame",
          data: frame.data,
          width: frame.metadata.deviceWidth,
          height: frame.metadata.deviceHeight,
        },
        ack
      )
    })
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      everyNthFrame: 1,
    })
    // The screencast sends a frame only when the page paints, so a page
    // that does not change would show nothing: send it one time first.
    const viewport = page.viewportSize()
    const image = await page
      .screenshot({ type: "jpeg", quality: 70 })
      .catch(() => undefined)
    if (image && viewport && this.#cdp === cdp)
      this.#send({
        type: "frame",
        data: image.toString("base64"),
        width: viewport.width,
        height: viewport.height,
      })
  }

  async #detach() {
    const cdp = this.#cdp
    this.#cdp = undefined
    this.#page = undefined
    if (!cdp) return
    await cdp.send("Page.stopScreencast").catch(() => undefined)
    await cdp.detach().catch(() => undefined)
  }

  #error(error: unknown) {
    this.#send({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    })
  }

  #persistSoon() {
    if (this.#persistTimer) clearTimeout(this.#persistTimer)
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined
      void this.#browser.persist(this.#conversationId).catch(() => undefined)
    }, PERSIST_DELAY_MS)
  }

  /** Do what the user did in the view. */
  async input(message: BrowserViewInput) {
    const conversation = this.#conversationId
    this.#browser.touch(conversation)
    try {
      if (message.type === "start") {
        await this.#browser.session(conversation, await this.#savedTabs())
        return
      }
      if (message.type === "navigate") {
        const text = message.url.trim()
        if (!text) return
        const url = /^\w+:\/\//.test(text) ? text : `https://${text}`
        const tabs = this.#browser.isOpen(conversation)
          ? []
          : await this.#savedTabs()
        await this.#browser.open(conversation, tabs, url, false)
        this.#persistSoon()
        return
      }
      if (message.type === "switch_tab") {
        await this.#browser.switchTab(conversation, message.id)
        return
      }
      if (message.type === "close_tab") {
        await this.#browser.closeTab(conversation, message.id)
        return
      }
      const page = this.#page
      if (!page || page.isClosed()) return
      switch (message.type) {
        case "mouse": {
          await page.mouse.move(message.x, message.y)
          const options = {
            button: message.button ?? "left",
            clickCount: message.clickCount ?? 1,
          } as const
          if (message.action === "down") await page.mouse.down(options)
          if (message.action === "up") {
            await page.mouse.up(options)
            this.#persistSoon()
          }
          break
        }
        case "wheel":
          await page.mouse.move(message.x, message.y)
          await page.mouse.wheel(message.dx, message.dy)
          break
        case "key":
          await page.keyboard.press(message.key)
          this.#persistSoon()
          break
        case "text":
          await page.keyboard.insertText(message.text)
          this.#persistSoon()
          break
        case "back":
          await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS })
          break
        case "forward":
          await page.goForward({ timeout: NAVIGATION_TIMEOUT_MS })
          break
        case "reload":
          await page.reload({ timeout: NAVIGATION_TIMEOUT_MS })
          break
      }
    } catch (error) {
      this.#error(error)
    }
  }
}
