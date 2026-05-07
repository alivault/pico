import { createFileRoute } from "@tanstack/react-router"

import { errorResponse, jsonResponse } from "@/server/http"
import { getPicoRuntime } from "@/server/pico-runtime"
import {
  listProjectFileTreePaths,
  resolveDirectoryPath,
} from "@/server/project-paths"
import { routeErrorResponse } from "@/server/route-helpers"

export const Route = createFileRoute("/api/files/tree")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const requestedCwd = url.searchParams.get("cwd") || ""
        if (!requestedCwd.trim()) {
          return errorResponse("cwd is required")
        }

        try {
          const { context, activeEntry } =
            await getPicoRuntime().resolveRequest(request)
          const baseCwd = getPicoRuntime().getBaseCwd(activeEntry, context)
          const cwd = await resolveDirectoryPath(requestedCwd, baseCwd)
          const paths = await listProjectFileTreePaths(cwd)
          return jsonResponse({
            ok: true,
            cwd,
            totalCount: paths.length,
            paths,
          })
        } catch (error) {
          return routeErrorResponse(error, "Failed to read file tree")
        }
      },
    },
  },
})
