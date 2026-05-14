import { errorResponse } from "@/server/http"

function formatRouteError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Unknown error"
}

function inferRouteErrorStatus(message: string) {
  const normalized = message.toLowerCase()

  if (
    normalized.includes("unknown model") ||
    normalized.includes("unknown slash command") ||
    normalized.includes("unknown ui request") ||
    normalized.includes("pending prompt not found")
  ) {
    return 404
  }

  if (
    normalized.includes("not found") ||
    normalized.includes("invalid") ||
    normalized.includes("required") ||
    normalized.includes("failed") ||
    normalized.includes("can only")
  ) {
    return 400
  }

  return 500
}

export function routeErrorResponse(error: unknown, fallbackMessage: string) {
  const message = formatRouteError(error) || fallbackMessage
  return errorResponse(message, inferRouteErrorStatus(message))
}

export async function readRequestJson<T extends object>(request: Request) {
  return (await request.json().catch(() => ({}))) as T
}
