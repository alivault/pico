/**
 * The `web-access` extension: pi-web-access's web tools (web_search,
 * fetch_content, get_search_content, source_check) as durable tools.
 *
 * pi-web-access keeps its tool behavior in a host-neutral core, which its own
 * MCP server also uses. Pico drives the same core and its MCP tool schemas.
 * Configuration is pi-web-access's own `~/.pi/web-search.json`.
 */
import type { TSchema } from "@earendil-works/pi-ai"
import {
  defineExtension,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { MCP_TOOL_DEFINITIONS } from "pi-web-access/mcp-tool-definitions.ts"
import { createStandaloneWebToolCore } from "pi-web-access/web-tool-core.ts"
import type { WebToolCore, WebToolResult } from "pi-web-access/web-tool-contract.ts"

type Runner = (
  core: WebToolCore,
  args: Record<string, unknown>,
  signal: AbortSignal
) => Promise<WebToolResult>

const RUNNERS: Record<string, Runner> = {
  web_search: (core, args, signal) => core.webSearch(args as never, signal),
  fetch_content: (core, args, signal) => core.fetchContent(args as never, signal),
  get_search_content: (core, args, signal) => core.getSearchContent(args as never, signal),
  source_check: (core, args, signal) => core.sourceCheck(args as never, signal),
}

let sharedCore: ReturnType<typeof createStandaloneWebToolCore> | undefined

function core() {
  sharedCore ??= createStandaloneWebToolCore()
  return sharedCore
}

function webTool(definition: (typeof MCP_TOOL_DEFINITIONS)[number]): ToolRegistration {
  const run = RUNNERS[definition.name]!
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema as unknown as TSchema,
    // Searches and fetches have no side effects worth guarding; a rerun after a
    // crash only repeats the request.
    replay: "safe",
    async execute(args, _api, context) {
      const signal = context.abortSignal ?? new AbortController().signal
      const result = await run(core(), args as Record<string, unknown>, signal)
      return {
        output: result.content,
        details: JSON.parse(JSON.stringify(result.details ?? {})),
        ...(result.isError ? { isError: true } : {}),
      }
    },
  }
}

export function createWebAccessExtension(): Extension {
  let enabled: readonly string[]
  try {
    enabled = core().enabledToolNames
  } catch (error) {
    console.warn("[pico] web access is unavailable:", error)
    enabled = []
  }
  return defineExtension({
    name: "web-access",
    tools: MCP_TOOL_DEFINITIONS.filter((tool) => enabled.includes(tool.name)).map(webTool),
  })
}
