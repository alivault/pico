import { errorResponse } from "@/server/http"

export type RouteMethod = "GET" | "POST"

export function notImplementedResponse(routePath: string) {
  return errorResponse(
    `${routePath} has not been ported to the native TypeScript backend yet.`,
    501,
    { routePath }
  )
}

export function createNotImplementedHandlers(
  routePath: string,
  methods: ReadonlyArray<RouteMethod>
) {
  return Object.fromEntries(
    methods.map((method) => [method, () => notImplementedResponse(routePath)])
  ) as Record<RouteMethod, () => Response>
}
