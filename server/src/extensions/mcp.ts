/**
 * The `mcp` extension: tools of the MCP servers in Pi's `mcp.json`.
 *
 * Tools are named `mcp__<server>__<tool>`, as in Pi. Each server's `exposure`
 * decides how the model reaches them, also as in Pi: `codemode` (default)
 * only from code mode scripts, `deferred` through tool search, `direct` as
 * ordinary tools, and `hidden` not at all. Servers connect in the background;
 * the tool list updates when they are ready.
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai"
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type Tool as McpTool,
} from "@earendil-works/pi-mcp"
import {
  defineExtension,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable"

type Exposure = "codemode" | "deferred" | "direct" | "hidden"

type ServerConfig = {
  type?: "stdio" | "http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  exposure?: Exposure | string
  toolExposure?: Record<string, Exposure>
  description?: string
  enabled?: boolean
}

type Server = {
  name: string
  config: ServerConfig
  client?: McpClient
  tools: McpTool[]
  error?: string
}

export type McpExtension = {
  readonly extension: Extension
  namespaces(): { name: string; description: string; prefix: string }[]
  onChange(listener: () => void): void
  status(): { name: string; connected: boolean; toolCount: number; error?: string }[]
  close(): Promise<void>
}

function toolName(server: string, tool: string) {
  return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64)
}

function namespace(server: string) {
  return `mcp__${server.replace(/-/g, "_")}`
}

function resolveValue(value: string) {
  if (value.startsWith("!")) {
    try {
      return execSync(value.slice(1), { encoding: "utf8", timeout: 10_000 }).trim()
    } catch {
      return ""
    }
  }
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => process.env[name] ?? "")
}

function resolveRecord(record: Record<string, string> | undefined) {
  if (!record) return undefined
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, resolveValue(value)]))
}

function normalizeExposure(value: unknown): Exposure {
  return value === "deferred" || value === "direct" || value === "hidden" ? value : "codemode"
}

function exposureOf(config: ServerConfig, tool: string): Exposure {
  const overrides = config.toolExposure ?? {}
  if (overrides[tool]) return normalizeExposure(overrides[tool])
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (!pattern.includes("*")) continue
    const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
    if (regex.test(tool)) return normalizeExposure(exposure)
  }
  return normalizeExposure(config.exposure)
}

function readConfig(agentDir: string): Record<string, ServerConfig> {
  for (const path of [join(agentDir, "mcp.json"), join(homedir(), ".pi", "agent", "mcp.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, ServerConfig> }
      return parsed.mcpServers ?? {}
    } catch {
      // Try the next location.
    }
  }
  return {}
}

export function createMcpExtension(agentDir: string): McpExtension {
  const servers = readConfigServers(agentDir)
  const listeners: Array<() => void> = []
  let extension = build(servers)

  const changed = () => {
    extension = build(servers)
    for (const listener of listeners) listener()
  }

  for (const server of servers) {
    if (server.config.enabled === false) continue
    void connect(server).then(changed, (error: unknown) => {
      server.error = error instanceof Error ? error.message : String(error)
      console.warn(`[pico] MCP server ${server.name} is unavailable: ${server.error}`)
    })
  }

  return {
    get extension() {
      return extension
    },
    namespaces: () =>
      servers
        .filter((server) => server.tools.length > 0)
        .map((server) => ({
          name: namespace(server.name),
          description: server.config.description ?? server.client?.instructions?.split("\n")[0] ?? `MCP server ${server.name}`,
          prefix: `${namespace(server.name)}__`,
        })),
    onChange: (listener) => {
      listeners.push(listener)
    },
    status: () =>
      servers.map((server) => ({
        name: server.name,
        connected: server.client?.connectionState === "connected",
        toolCount: server.tools.length,
        ...(server.error ? { error: server.error } : {}),
      })),
    async close() {
      await Promise.allSettled(servers.map((server) => server.client?.close()))
    },
  }
}

function readConfigServers(agentDir: string): Server[] {
  return Object.entries(readConfig(agentDir)).map(([name, config]) => ({ name, config, tools: [] }))
}

async function connect(server: Server) {
  const { config } = server
  const client = new McpClient({ name: "pico", version: "3", requestTimeoutMs: 120_000 })
  const transport = config.url
    ? new StreamableHttpTransport({
        url: config.url,
        ...(config.headers ? { headers: resolveRecord(config.headers) } : {}),
      })
    : config.command
      ? new StdioTransport({
          command: resolveValue(config.command),
          args: (config.args ?? []).map(resolveValue),
          ...(config.env ? { env: resolveRecord(config.env) } : {}),
          ...(config.cwd ? { cwd: config.cwd } : {}),
          stderr: "pipe",
        })
      : undefined
  if (!transport) throw new Error("needs a command or a url")
  await client.connect(transport)
  server.client = client
  server.tools = await client.listTools()
  client.onClose(() => {
    server.error = "connection closed"
  })
}

function build(servers: Server[]): Extension {
  const tools: ToolRegistration[] = []
  for (const server of servers) {
    for (const tool of server.tools) {
      const exposure = exposureOf(server.config, tool.name)
      if (exposure === "hidden") continue
      tools.push({
        name: toolName(server.name, tool.name),
        description: tool.description ?? `${tool.name} from MCP server ${server.name}`,
        parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as unknown as TSchema,
        ...(exposure === "codemode" ? { callers: ["tools"] as const } : {}),
        ...(exposure === "deferred" ? { deferred: true as const } : {}),
        async execute(args, _api, context) {
          const client = server.client
          if (!client || client.connectionState !== "connected") {
            throw new Error(`MCP server ${server.name} is not connected`)
          }
          const result = await client.callTool(tool.name, args as Record<string, unknown>, {
            ...(context.abortSignal ? { signal: context.abortSignal } : {}),
          })
          const content: Array<TextContent | ImageContent> = []
          for (const part of toLlmContent(result)) {
            if (part.type === "text") content.push({ type: "text", text: part.text })
            else if (part.type === "image") content.push({ type: "image", data: part.data, mimeType: part.mimeType })
          }
          return {
            output: content.length > 0 ? content : [{ type: "text", text: "(no output)" }],
            ...(result.isError ? { isError: true } : {}),
          }
        },
      })
    }
  }
  return defineExtension({ name: "mcp", tools })
}
