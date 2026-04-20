import { createFileRoute } from "@tanstack/react-router"

import { jsonResponse } from "@/server/http"
import { getPiWebRuntime } from "@/server/pi-web-runtime"
import { resolveDirectoryPath } from "@/server/project-paths"
import { readRequestJson, routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/directory/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await readRequestJson<{ path?: unknown }>(request)
          const { context, activeEntry } =
            await getPiWebRuntime().resolveRequest(request)
          const pathInput = typeof body.path === "string" ? body.path : ""
          const baseCwd = getPiWebRuntime().getBaseCwd(activeEntry, context)
          return jsonResponse({
            ok: true,
            path: await resolveDirectoryPath(pathInput, baseCwd),
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to resolve directory")
        }
      },
    },
  },
})
