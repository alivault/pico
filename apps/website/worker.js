/**
 * Static assets answer a range request with the whole file (200). Safari and
 * iPhones then do not play a video, so this Worker answers range requests for
 * `/videos/*` (see `run_worker_first` in wrangler.jsonc) with 206.
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 200) return response
    const headers = new Headers(response.headers)
    headers.set("accept-ranges", "bytes")
    const range = request.headers.get("range")
    const match = /^bytes=(\d*)-(\d*)$/.exec(range?.trim() ?? "")
    if (request.method !== "GET" || !match || (!match[1] && !match[2]))
      return new Response(response.body, { status: 200, headers })

    const body = await response.arrayBuffer()
    const size = body.byteLength
    const start = match[1]
      ? Number(match[1])
      : Math.max(0, size - Number(match[2]))
    const end =
      match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      headers.set("content-range", `bytes */${size}`)
      headers.delete("content-length")
      return new Response(null, { status: 416, headers })
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`)
    headers.set("content-length", String(end - start + 1))
    return new Response(body.slice(start, end + 1), { status: 206, headers })
  },
}
