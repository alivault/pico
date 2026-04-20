import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { listPathCompletionEntries } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/path-completions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ prefix?: unknown }>(request)
          const { context, activeEntry } =
            await getPiWebRuntime().resolveRequest(request)
          const prefix = typeof body.prefix === "string" ? body.prefix : ""
          const baseCwd = getPiWebRuntime().getBaseCwd(activeEntry, context)
          const items = await listPathCompletionEntries(prefix, baseCwd)
          return jsonResponse({
            ok: true,
            prefix,
            totalCount: items.length,
            items,
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to list path completions")
        }
      },
    },
  },
})
