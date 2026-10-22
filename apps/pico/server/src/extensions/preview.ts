/**
 * The `preview` extension: show a running web app in the web client.
 *
 * `preview_url` opens a preview proxy (see `services/preview.ts`) for a local
 * dev server and records it in the `pico.preview` document; the client shows
 * it in the Preview panel. With `job_id`, it first waits until the job's
 * server answers. `preview_screenshot` gives the model an image of the page.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type ConversationId,
} from "@earendil-works/pi-durable"

import { localTarget, waitForUrl } from "../services/preview.ts"
import { sessionIdOf, type HostBridge } from "./host.ts"
import { JobsDoc } from "./jobs.ts"
import { errorResult, json, registerState, textResult } from "./util.ts"

export type PreviewState = {
  /** The dev server, for example http://127.0.0.1:5173. */
  target?: string
  path: string
  /** The preview proxy port, while it runs in this server. */
  port?: number
  jobId?: string
  title?: string
  updatedAt: number
}

export const PreviewDoc = defineDoc<PreviewState>({
  kind: "pico.preview",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ path: "/", updatedAt: 0 }),
})

registerState({
  key: "preview",
  kinds: ["pico.preview"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(PreviewDoc, conversationId, context)
    return state?.target ? json(state) : undefined
  },
})

/** Open (or reopen after a restart) the proxy of a session's preview. */
export async function ensurePreview(
  host: HostBridge,
  conversationId: ConversationId
) {
  const services = await host.ready()
  if (!services.previews) throw new Error("Previews are not available")
  const state = await services.harness.snapshot(
    PreviewDoc,
    conversationId,
    BACKGROUND_CONTEXT
  )
  if (!state?.target) throw new Error("This session has no preview")
  const proxy = await services.previews.open(
    state.target,
    sessionIdOf(conversationId)
  )
  if (proxy.port !== state.port) {
    await services.harness.commit(async (tx) => {
      const draft = await tx.doc(PreviewDoc, conversationId)
      draft.port = proxy.port
      draft.updatedAt = Date.now()
    }, BACKGROUND_CONTEXT)
  }
  return { ...state, port: proxy.port }
}

export function createPreviewExtension(host: HostBridge) {
  const previewTool = defineTool({
    name: "preview_url",
    description: [
      "Show a local web app (a dev server) in the user's Preview panel. It also works when the user is on a phone: Pico forwards a port to the dev server.",
      "Give url (http://localhost:5173) or port. With job_id (from job_start), wait until that job's server answers. path opens a page of the app.",
    ].join(" "),
    parameters: Type.Object({
      url: Type.Optional(Type.String()),
      port: Type.Optional(Type.Number()),
      job_id: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      wait_seconds: Type.Optional(Type.Number()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      if (!services.previews) return errorResult("Previews are not available")
      let target: URL
      try {
        target = localTarget(
          args.url ?? (args.port ? `http://127.0.0.1:${args.port}` : "")
        )
      } catch (error) {
        return errorResult(
          args.url || args.port
            ? error instanceof Error
              ? error.message
              : String(error)
            : "Give url or port"
        )
      }
      if (args.job_id) {
        const jobs = await api.snapshot(JobsDoc, api.conversationId, context)
        const job = jobs?.items[args.job_id]
        if (!job) return errorResult(`No job ${args.job_id}`)
        if (job.status !== "running")
          return errorResult(`Job ${args.job_id} is ${job.status}`)
      }
      try {
        await waitForUrl(
          target.origin,
          Math.min(300, args.wait_seconds ?? (args.job_id ? 90 : 10)) * 1000,
          context.abortSignal
        )
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const proxy = await services.previews.open(
        target.origin,
        sessionIdOf(api.conversationId)
      )
      const path = args.path ?? (target.pathname || "/")
      await api.commit(async (tx) => {
        const draft = await tx.doc(PreviewDoc, api.conversationId)
        Object.assign(draft, {
          target: target.origin,
          path: path.startsWith("/") ? path : `/${path}`,
          port: proxy.port,
          updatedAt: Date.now(),
          ...(args.job_id ? { jobId: args.job_id } : {}),
          ...(args.title ? { title: args.title } : {}),
        })
        if (!args.job_id) delete draft.jobId
      }, context)
      return textResult(
        `The Preview panel shows ${target.origin}${path} (forwarded on port ${proxy.port}).`,
        { details: { target: target.origin, path, port: proxy.port } }
      )
    },
  })

  const screenshotTool = defineTool({
    name: "preview_screenshot",
    description:
      "Take a screenshot of this session's preview (or of url) at a viewport width, to check the page yourself.",
    parameters: Type.Object({
      url: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      width: Type.Optional(Type.Number()),
      full_page: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const services = await host.ready(context.abortSignal)
      if (!services.browser) return errorResult("The browser is not available")
      const state = await api.snapshot(PreviewDoc, api.conversationId, context)
      let url: string
      try {
        url = args.url
          ? localTarget(args.url).href
          : state?.target
            ? new URL(args.path ?? state.path ?? "/", state.target).href
            : ""
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      if (!url)
        return errorResult(
          "This session has no preview. Use preview_url first."
        )
      try {
        const session = await services.browser.session(
          Number(api.conversationId)
        )
        const page = await session.context.newPage()
        try {
          await page.setViewportSize({
            width: Math.min(2560, Math.max(320, args.width ?? 1280)),
            height: 900,
          })
          await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 })
          const image = await page.screenshot({
            fullPage: Boolean(args.full_page),
            type: "png",
          })
          const data = image.toString("base64")
          return {
            output: [
              { type: "text", text: `Screenshot of ${url}` },
              { type: "image", mimeType: "image/png", data },
            ],
            details: {
              kind: "image",
              title: url,
              data: `data:image/png;base64,${data}`,
            },
          }
        } finally {
          await page.close().catch(() => undefined)
        }
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
    },
  })

  const closeTool = defineTool({
    name: "preview_close",
    description: "Remove this session's preview from the Preview panel.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute(_args, api, context) {
      await api.commit(async (tx) => {
        const draft = await tx.doc(PreviewDoc, api.conversationId)
        delete draft.target
        delete draft.port
        delete draft.jobId
        draft.updatedAt = Date.now()
      }, context)
      return textResult("The preview is closed.")
    },
  })

  return defineExtension({
    name: "preview",
    tools: [previewTool, screenshotTool, closeTool],
  })
}
