import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { listFileReferenceEntries } from "@/server/project-paths"

export const Route = createFileRoute("/api/file-completions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          query?: unknown
          isQuotedPrefix?: unknown
        }
        const query = typeof body.query === "string" ? body.query : ""
        const isQuotedPrefix = Boolean(body.isQuotedPrefix)
        const items = await listFileReferenceEntries(query, process.cwd(), {
          isQuotedPrefix,
        })

        return jsonResponse({
          ok: true,
          query,
          totalCount: items.length,
          items,
        })
      },
    },
  },
})
