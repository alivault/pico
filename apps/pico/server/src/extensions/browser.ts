/**
 * The `browser` extension: a durable browser for the agent.
 *
 * Each conversation has its own Chrome context. Its cookies and local storage
 * survive restarts (a file per conversation), and its open tabs are kept in
 * the `pico.browser` document, so they open again after a restart.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
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
  }
  type Action = (
    browser: BrowserManager,
    tabs: BrowserTab[],
    args: Args,
    api: ToolExecutionApi
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

  const screenshot: Action = async (browser, tabs, args, api) => {
    const { page } = await browser.page(Number(api.conversationId), tabs)
    const image = await page.screenshot({
      fullPage: Boolean(args.full_page),
      type: "png",
    })
    const data = image.toString("base64")
    return {
      output: [
        { type: "text", text: `Screenshot of ${page.url()}` },
        { type: "image", mimeType: "image/png", data },
      ],
      details: {
        kind: "image",
        title: page.url(),
        data: `data:image/png;base64,${data}`,
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
    screenshot,
    eval: evaluate,
    tabs: tabList,
    switch_tab: tabList,
    close_tab: tabList,
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
      "screenshot (full_page);",
      "eval (a JavaScript expression in the page; returns its JSON value);",
      "tabs, switch_tab (id), close_tab (id);",
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
    }),
    async execute(args, api, context) {
      const action = String(args.action)
      const run = ACTIONS[action]
      if (!run) return errorResult(`Unknown action: ${action}`)
      const denied =
        action === "eval"
          ? deniedAction(host, api.conversationId, "browser.eval")
          : ACT.includes(action)
            ? deniedAction(host, api.conversationId, "browser.act")
            : undefined
      if (denied) return denied
      return withBrowser(api, context, (browser, tabs) =>
        run(browser, tabs, { ...args, action }, api)
      )
    },
  })

  return defineExtension({ name: "browser", tools: [browserTool] })
}
