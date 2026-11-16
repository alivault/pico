/**
 * The `browser` extension: a durable browser for the agent.
 *
 * Each conversation has its own Chrome context. Its cookies and local storage
 * survive restarts (a file per conversation), and its open tabs are kept in
 * the `pico.browser` document, so they open again after a restart.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

import type { Context } from "@earendil-works/chord"
import { Type, type ImageContent } from "@earendil-works/pi-ai"
import { resizeImage } from "@earendil-works/pi-coding-agent"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"

import {
  formatSnapshot,
  type BrowserManager,
  type BrowserTab,
} from "../services/browser.ts"
import { askAndWait } from "./ask.ts"
import type { HostBridge } from "./host.ts"
import {
  clip,
  deniedAction,
  errorResult,
  json,
  registerState,
  textResult,
} from "./util.ts"

export type BrowserState = {
  tabs: BrowserTab[]
  active?: string
  updatedAt: number
}

export const BrowserDoc = defineDoc<BrowserState>({
  kind: "pico.browser",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ tabs: [], updatedAt: 0 }),
})

registerState({
  key: "browser",
  kinds: ["pico.browser"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(BrowserDoc, conversationId, context)
    return state && state.tabs.length > 0 ? json(state) : undefined
  },
})

/** A page script may never settle; give up after this time. */
const EVAL_TIMEOUT_MS = 60_000

/**
 * Wait for `work`, but stop when `signal` aborts. Browser calls do not take a
 * signal, and a page script that never settles must not block an abort.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined) {
  if (!signal) return work
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new Error("Aborted"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}

/** Reject when `work` takes longer than `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export function createBrowserExtension(host: HostBridge) {
  const withBrowser = async (
    api: ToolExecutionApi,
    context: Context,
    work: (
      browser: BrowserManager,
      tabs: BrowserTab[]
    ) => Promise<ToolExecutionResult>
  ): Promise<ToolExecutionResult> => {
    const services = await host.ready(context.abortSignal)
    if (!services.browser) return errorResult("The browser is not available")
    const state = await api.snapshot(BrowserDoc, api.conversationId, context)
    const signal = context.abortSignal
    try {
      const result = await untilAborted(
        work(services.browser, state?.tabs ?? []),
        signal
      )
      const conversation = Number(api.conversationId)
      await services.browser.persist(conversation).catch(() => undefined)
      const tabs = await services.browser.tabs(conversation)
      await api.commit(async (tx) => {
        const draft = await tx.doc(BrowserDoc, api.conversationId)
        draft.tabs = json(tabs.tabs)
        if (tabs.active) draft.active = tabs.active
        else delete draft.active
        draft.updatedAt = Date.now()
      }, context)
      return result
    } catch (error) {
      if (signal?.aborted) throw error
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  type Args = {
    action: string
    url?: string | undefined
    new_tab?: boolean | undefined
    ref?: number | undefined
    selector?: string | undefined
    text?: string | undefined
    value?: string | undefined
    full_page?: boolean | undefined
    expression?: string | undefined
    id?: string | undefined
    paths?: string[] | undefined
  }
  type Action = (
    browser: BrowserManager,
    tabs: BrowserTab[],
    args: Args,
    api: ToolExecutionApi,
    context: Context
  ) => Promise<ToolExecutionResult>

  const open: Action = async (browser, tabs, args, api) => {
    if (!args.url) throw new Error("open needs url")
    const url = /^\w+:\/\//.test(args.url) ? args.url : `https://${args.url}`
    const { id, page } = await browser.open(
      Number(api.conversationId),
      tabs,
      url,
      Boolean(args.new_tab)
    )
    const snapshot = await browser.snapshot(page)
    return textResult(`Tab ${id}: ${clip(formatSnapshot(snapshot), 30_000)}`)
  }

  const snapshot: Action = async (browser, tabs, _args, api) => {
    const { page } = await browser.page(Number(api.conversationId), tabs)
    return textResult(
      clip(formatSnapshot(await browser.snapshot(page)), 30_000)
    )
  }

  const act: Action = async (browser, tabs, args, api) => {
    const { page } = await browser.page(Number(api.conversationId), tabs)
    const action = args.action
    const locator =
      args.ref !== undefined
        ? page.locator(`[data-pico-ref="${args.ref}"]`)
        : args.selector
          ? page.locator(args.selector).first()
          : args.text
            ? page.getByText(args.text, { exact: false }).first()
            : undefined
    const timeout = 15_000
    switch (action) {
      case "scroll":
        await page.mouse.wheel(0, args.value === "up" ? -800 : 800)
        break
      case "press":
        if (locator) await locator.press(args.value ?? "Enter", { timeout })
        else await page.keyboard.press(args.value ?? "Enter")
        break
      default: {
        if (!locator) throw new Error("Give ref, selector, or text")
        if (action === "click") await locator.click({ timeout })
        else if (action === "fill")
          await locator.fill(args.value ?? "", { timeout })
        else if (action === "type")
          await locator.pressSequentially(args.value ?? "", { timeout })
        else if (action === "select")
          await locator.selectOption(args.value ?? "", { timeout })
        else if (action === "check") await locator.check({ timeout })
        else if (action === "uncheck") await locator.uncheck({ timeout })
        else if (action === "hover") await locator.hover({ timeout })
      }
    }
    await page
      .waitForLoadState("domcontentloaded", { timeout: 10_000 })
      .catch(() => undefined)
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => undefined)
    return textResult(
      `Done: ${action}.\n${clip(formatSnapshot(await browser.snapshot(page)), 30_000)}`
    )
  }

  /** Upload files: on a file input, or on the button that opens a dialog. */
  const upload: Action = async (browser, tabs, args, api) => {
    const paths = (args.paths ?? []).map((path) =>
      path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
    )
    if (paths.length === 0) throw new Error("upload needs paths")
    for (const path of paths) {
      if (!isAbsolute(path)) throw new Error(`Give an absolute path: ${path}`)
      if (!existsSync(path)) throw new Error(`No such file: ${path}`)
    }
    const conversation = Number(api.conversationId)
    const { page } = await browser.page(conversation, tabs)
    const target =
      args.ref !== undefined
        ? page.locator(`[data-pico-ref="${args.ref}"]`)
        : args.selector
          ? page.locator(args.selector).first()
          : args.text
            ? page.getByText(args.text, { exact: false }).first()
            : page.locator('input[type="file"]').first()
    await browser.upload(conversation, page, target, paths, 15_000)
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => undefined)
    return textResult(
      `Uploaded ${paths.length === 1 ? "1 file" : `${paths.length} files`}.\n${clip(formatSnapshot(await browser.snapshot(page)), 30_000)}`
    )
  }

  /**
   * The model API refuses an image larger than 8000 px, and larger than
   * 2000 px when a request has many images. That error comes back on every
   * later turn, because the image stays in the history. So a full-page
   * screenshot is cut into parts of at most SHOT_PART_PX, and each image is
   * fitted to 2000 px and 4.5 MB.
   */
  const SHOT_PART_PX = 2000
  const SHOT_MAX_PARTS = 4

  const fitShot = async (png: Buffer): Promise<ImageContent> => {
    const data = png.toString("base64")
    try {
      const resized = await resizeImage(png, "image/png")
      if (resized?.wasResized) {
        return { type: "image", mimeType: resized.mimeType, data: resized.data }
      }
    } catch {
      // Send the original image.
    }
    return { type: "image", mimeType: "image/png", data }
  }

  const screenshot: Action = async (browser, tabs, args, api) => {
    const { page } = await browser.page(Number(api.conversationId), tabs)
    const shots: Buffer[] = []
    let note = ""
    if (args.full_page) {
      const size = (await page.evaluate(
        "({ width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) })"
      )) as { width: number; height: number }
      const height = Math.max(1, Math.ceil(size.height))
      const width = Math.max(1, Math.ceil(size.width))
      const parts = Math.min(SHOT_MAX_PARTS, Math.ceil(height / SHOT_PART_PX))
      for (let i = 0; i < parts; i++) {
        const y = i * SHOT_PART_PX
        shots.push(
          await page.screenshot({
            fullPage: true,
            type: "png",
            clip: {
              x: 0,
              y,
              width,
              height: Math.min(SHOT_PART_PX, height - y),
            },
          })
        )
      }
      if (parts > 1) {
        note = ` (page ${width}x${height} px, in ${parts} parts of ${SHOT_PART_PX} px from the top)`
      }
      if (height > parts * SHOT_PART_PX) {
        note += `. Only the top ${parts * SHOT_PART_PX} px are shown: scroll and take viewport screenshots to see the rest`
      }
    } else {
      shots.push(await page.screenshot({ type: "png" }))
    }
    const images = await Promise.all(shots.map(fitShot))
    const first = images[0]
    return {
      output: [
        { type: "text", text: `Screenshot of ${page.url()}${note}` },
        ...images,
      ],
      details: {
        kind: "image",
        title: page.url(),
        data: first ? `data:${first.mimeType};base64,${first.data}` : "",
      },
    }
  }

  const evaluate: Action = async (browser, tabs, args, api) => {
    if (!args.expression) throw new Error("eval needs expression")
    const { page } = await browser.page(Number(api.conversationId), tabs)
    const value = (await withTimeout(
      page.evaluate(`(async () => (${args.expression}))()`),
      EVAL_TIMEOUT_MS,
      `The expression did not finish in ${EVAL_TIMEOUT_MS / 1000} seconds`
    )) as unknown
    return textResult(
      clip(JSON.stringify(value, null, 2) ?? "undefined", 30_000)
    )
  }

  const tabList: Action = async (browser, tabs, args, api) => {
    const conversation = Number(api.conversationId)
    await browser.session(conversation, tabs)
    if (args.action === "switch_tab") {
      if (!args.id) throw new Error("switch_tab needs id")
      await browser.switchTab(conversation, args.id)
    }
    if (args.action === "close_tab") {
      if (!args.id) throw new Error("close_tab needs id")
      await browser.closeTab(conversation, args.id)
    }
    const now = await browser.tabs(conversation)
    return textResult(
      now.tabs.length
        ? now.tabs
            .map(
              (tab) =>
                `${tab.id === now.active ? "*" : " "} ${tab.id} ${tab.title} — ${tab.url}`
            )
            .join("\n")
        : "No open tabs."
    )
  }

  /**
   * Let the user use the browser, for example to log in, and wait until the
   * user answers. The Browser tab of the web client shows the page live and
   * sends the user's clicks and keys to it. The wait is a question, so the
   * agent shows that it needs the user, and a notification goes out.
   */
  const handoff: Action = async (browser, tabs, args, api, context) => {
    const reason = args.text?.trim()
    if (!reason) throw new Error("handoff needs text: what the user should do")
    const conversation = Number(api.conversationId)
    await browser.session(conversation, tabs)
    const end = browser.startHandoff(conversation, {
      questionId: api.callId,
      reason,
    })
    try {
      const question = await askAndWait(api, context, {
        prompt: reason,
        kind: "choice",
        options: [{ label: "Done" }, { label: "I can't do it" }],
        allowOther: true,
        browser: true,
      })
      if (question.cancelled || !question.answer)
        return textResult("The user closed the handoff without an answer.", {
          isError: true,
          details: { questionId: question.id, status: "cancelled" },
        })
      const answer = question.answer.text
      const page = await browser.activePage(conversation)
      const now = page
        ? `\n${clip(formatSnapshot(await browser.snapshot(page.page)), 30_000)}`
        : ""
      return textResult(`The user answered: ${answer}${now}`, {
        details: {
          questionId: question.id,
          status: "answered",
          answer: { text: answer, via: question.answer.via },
        },
      })
    } finally {
      end()
    }
  }

  const close: Action = async (browser, _tabs, _args, api) => {
    await browser.closeSession(Number(api.conversationId))
    return textResult("The browser is closed. Its cookies are saved.")
  }

  const ACT = [
    "click",
    "fill",
    "type",
    "press",
    "select",
    "check",
    "uncheck",
    "hover",
    "scroll",
  ]
  const ACTIONS: Record<string, Action> = {
    open,
    snapshot,
    ...Object.fromEntries(ACT.map((name) => [name, act])),
    upload,
    screenshot,
    eval: evaluate,
    tabs: tabList,
    switch_tab: tabList,
    close_tab: tabList,
    handoff,
    close,
  }

  const browserTool = defineTool({
    name: "browser",
    // Actions share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description: [
      "Your own browser. Logins and cookies persist across restarts. Actions:",
      "open (url, new_tab: open a page and read it: its title, headings, numbered interactive elements, and text);",
      "snapshot (read the current page again);",
      "click, fill (replace the text of a field with value), type (add the keys of value), press (a key such as Enter), select (an option), check, uncheck, hover, scroll (value down or up): target an element with ref (from the last snapshot), a CSS selector, or its visible text; returns the new snapshot;",
      "upload (paths: absolute paths of files on this machine; target the file input, or the button that opens the file dialog, with ref, selector, or text; with no target, the first file input);",
      "screenshot (full_page);",
      "eval (a JavaScript expression in the page; returns its JSON value);",
      "tabs, switch_tab (id), close_tab (id);",
      "handoff (text: what the user should do, for example log in to a site or solve a captcha; the user sees your browser live in Pico and uses it, and the call waits until the user answers; use it only when you cannot go on yourself);",
      "close (close the browser; cookies stay saved).",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(
        Object.keys(ACTIONS).map((name) => Type.Literal(name))
      ),
      url: Type.Optional(Type.String()),
      new_tab: Type.Optional(Type.Boolean()),
      ref: Type.Optional(Type.Number()),
      selector: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      value: Type.Optional(Type.String()),
      full_page: Type.Optional(Type.Boolean()),
      expression: Type.Optional(Type.String()),
      id: Type.Optional(Type.String({ description: "A tab ID" })),
      paths: Type.Optional(
        Type.Array(Type.String(), { description: "Files to upload" })
      ),
    }),
    async execute(args, api, context) {
      const action = String(args.action)
      const run = ACTIONS[action]
      if (!run) return errorResult(`Unknown action: ${action}`)
      const denied =
        action === "eval"
          ? deniedAction(host, api.conversationId, "browser.eval")
          : ACT.includes(action) || action === "upload"
            ? deniedAction(host, api.conversationId, "browser.act")
            : undefined
      if (denied) return denied
      return withBrowser(api, context, (browser, tabs) =>
        run(browser, tabs, { ...args, action }, api, context)
      )
    },
  })

  return defineExtension({ name: "browser", tools: [browserTool] })
}
