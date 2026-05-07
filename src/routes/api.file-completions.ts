import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { listFileReferenceEntries } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/file-completions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{
            query?: unknown
            isQuotedPrefix?: unknown
          }>(request)
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const query = typeof body.query === "string" ? body.query : ""
          const isQuotedPrefix = Boolean(body.isQuotedPrefix)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const items = await listFileReferenceEntries(query, baseCwd, {
            isQuotedPrefix,
          })
          return jsonResponse({
            ok: true,
            query,
            totalCount: items.length,
            items,
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to list file completions")
        }
      },
    },
  },
})
