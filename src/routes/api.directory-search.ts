import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import { searchDirectoryEntries } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ query?: unknown }>(request)
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const query = typeof body.query === "string" ? body.query : ""
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const items = await searchDirectoryEntries(query, baseCwd)
          return jsonResponse({
            ok: true,
            query,
            totalCount: items.length,
            items,
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to search directories")
        }
      },
    },
  },
})
