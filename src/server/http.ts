export function jsonResponse(data: unknown, init: ResponseInit | number = 200) {
  const responseInit = typeof init === "number" ? { status: init } : init

  const headers = new Headers(responseInit.headers)
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8")
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store")
  }

  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers,
  })
}

export function errorResponse(
  message: string,
  status = 400,
  extras?: Record<string, unknown>
) {
  return jsonResponse(
    {
      ok: false,
      error: message,
      ...extras,
    },
    status
  )
}
