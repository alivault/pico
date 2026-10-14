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
import { clip, errorResult, json, registerState, textResult } from "./util.ts"

export type BrowserState = {
  tabs: BrowserTab[]
  active?: string
  updatedAt: number
}

export const BrowserDoc = defineDoc<BrowserState>({
  kind: "pico.browser",
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
    try {
      const result = await work(services.browser, state?.tabs ?? [])
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
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  const openTool = defineTool({
    name: "browser_open",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description:
      "Open a URL in your browser and read the page: its title, headings, numbered interactive elements (refs for browser_act), and text. Logins and cookies persist across restarts.",
    parameters: Type.Object({
      url: Type.String(),
      new_tab: Type.Optional(Type.Boolean()),
    }),
    execute: (args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
        const url = /^\w+:\/\//.test(args.url)
          ? args.url
          : `https://${args.url}`
        const { id, page } = await browser.open(
          Number(api.conversationId),
          tabs,
          url,
          Boolean(args.new_tab)
        )
        const snapshot = await browser.snapshot(page)
        return textResult(
          `Tab ${id}: ${clip(formatSnapshot(snapshot), 30_000)}`
        )
      }),
  })

  const snapshotTool = defineTool({
    name: "browser_snapshot",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description:
      "Read the current page of your browser again: elements with refs, and text.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: (_args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
        const { page } = await browser.page(Number(api.conversationId), tabs)
        return textResult(
          clip(formatSnapshot(await browser.snapshot(page)), 30_000)
        )
      }),
  })

  const actTool = defineTool({
    name: "browser_act",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description: [
      "Act on the current page: click, fill (replace the text of a field), type (add keys), press (a key such as Enter), select (an option), check, uncheck, hover, or scroll (down or up).",
      "Target an element with ref (from the last snapshot), a CSS selector, or its visible text. Returns the new page snapshot.",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(
        [
          "click",
          "fill",
          "type",
          "press",
          "select",
          "check",
          "uncheck",
          "hover",
          "scroll",
        ].map((action) => Type.Literal(action))
      ),
      ref: Type.Optional(Type.Number()),
      selector: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      value: Type.Optional(Type.String()),
    }),
    execute: (args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
        const { page } = await browser.page(Number(api.conversationId), tabs)
        const action = String(args.action)
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
      }),
  })

  const screenshotTool = defineTool({
    name: "browser_screenshot",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description: "Take a screenshot of the current page of your browser.",
    parameters: Type.Object({ full_page: Type.Optional(Type.Boolean()) }),
    replay: "safe",
    execute: (args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
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
      }),
  })

  const evalTool = defineTool({
    name: "browser_eval",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description:
      "Evaluate a JavaScript expression in the current page and return its JSON value.",
    parameters: Type.Object({ expression: Type.String() }),
    execute: (args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
        const { page } = await browser.page(Number(api.conversationId), tabs)
        const value = (await page.evaluate(
          `(async () => (${args.expression}))()`
        )) as unknown
        return textResult(
          clip(JSON.stringify(value, null, 2) ?? "undefined", 30_000)
        )
      }),
  })

  const tabsTool = defineTool({
    name: "browser_tabs",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description: "List your browser tabs, switch to one, or close one.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([
          Type.Literal("list"),
          Type.Literal("switch"),
          Type.Literal("close"),
        ])
      ),
      id: Type.Optional(Type.String()),
    }),
    execute: (args, api, context) =>
      withBrowser(api, context, async (browser, tabs) => {
        const conversation = Number(api.conversationId)
        await browser.session(conversation, tabs)
        if (args.action === "switch" && args.id)
          await browser.switchTab(conversation, args.id)
        if (args.action === "close" && args.id)
          await browser.closeTab(conversation, args.id)
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
      }),
  })

  const closeTool = defineTool({
    name: "browser_close",
    // Browser tools share pages, so a round that uses them runs in order.
    executionMode: "sequential",
    description: "Close your browser. Cookies stay saved for next time.",
    parameters: Type.Object({}),
    execute: (_args, api, context) =>
      withBrowser(api, context, async (browser) => {
        await browser.closeSession(Number(api.conversationId))
        return textResult("The browser is closed. Its cookies are saved.")
      }),
  })

  return defineExtension({
    name: "browser",
    tools: [
      openTool,
      snapshotTool,
      actTool,
      screenshotTool,
      evalTool,
      tabsTool,
      closeTool,
    ],
  })
}
