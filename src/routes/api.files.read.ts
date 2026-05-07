import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import {
  readProjectFileContent,
  resolveDirectoryPath,
} from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/files/read")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        const requestedPath = url.searchParams.get("path") || ""
        if (!requestedCwd.trim()) {
          return errorResponse("cwd is required")
        }
        if (!requestedPath.trim()) {
          return errorResponse("path is required")
        }

        try {
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const file = await readProjectFileContent(cwd, requestedPath)
          return jsonResponse({
            ok: true,
            cwd,
            path: file.path,
            content: file.content,
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to read file")
        }
      },
    },
  },
})
