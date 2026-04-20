import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { listPathCompletionEntries } from "@/server/project-paths"

export const Route = createFileRoute("/api/path-completions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          prefix?: unknown
        }
        const prefix = typeof body.prefix === "string" ? body.prefix : ""
        const items = await listPathCompletionEntries(prefix, process.cwd())

        return jsonResponse({
          ok: true,
          prefix,
          totalCount: items.length,
          items,
        })
      },
    },
  },
})
