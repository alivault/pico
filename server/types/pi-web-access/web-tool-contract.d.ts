// Types of the pi-web-access modules Pico uses. The package ships TypeScript
// sources that do not type-check under Pico's settings; esbuild bundles them.
export type WebToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export interface WebToolResult {
  content: WebToolContent[]
  details: Record<string, unknown>
  isError?: boolean
  structuredContent?: unknown
}

export interface WebToolCore {
  webSearch(params: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult>
  fetchContent(params: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult>
  getSearchContent(params: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult>
  sourceCheck(params: Record<string, unknown>, signal?: AbortSignal): Promise<WebToolResult>
}
