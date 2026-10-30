/**
 * The `mcp` extension: tools of the MCP servers in Pi's `mcp.json`.
 *
 * Tools are named `mcp__<server>__<tool>`, as in Pi. Each server's `exposure`
 * decides how the model reaches them, also as in Pi: `codemode` (default)
 * only from code mode scripts, `direct` as ordinary tools, and `hidden` not
 * at all. Pico has no tool search, so Pi's `deferred` works as `codemode`.
 * Servers connect in the background; the tool list updates when they are
 * ready.
 *
 * HTTP servers can use OAuth: the user signs in from Pico's settings, and the
 * tokens go to `<data>/mcp-oauth.json`. A server with `replaySafe: true` (for
 * read-only servers) gets replay-safe tools, which rerun after a crash.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai"
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type Tool as McpTool,
} from "@earendil-works/pi-mcp"
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  type McpOAuthState,
} from "@earendil-works/pi-mcp/oauth"
import {
  defineExtension,
  type Extension,
  type ToolRegistration,
} from "@earendil-works/pi-durable"

type Exposure = "codemode" | "direct" | "hidden"

type ServerConfig = {
  type?: "stdio" | "http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  exposure?: string
  toolExposure?: Record<string, Exposure>
  description?: string
  enabled?: boolean
  /** The server's tools have no side effects, so they may rerun after a crash. */
  replaySafe?: boolean
}

type Server = {
  name: string
  config: ServerConfig
  client?: McpClient
  tools: McpTool[]
  error?: string
  /** The server answered that the user must sign in. */
  needsAuth?: boolean
}

export type McpExtension = {
  readonly extension: Extension
  namespaces(): { name: string; description: string; prefix: string }[]
  onChange(listener: () => void): void
  status(): {
    name: string
    connected: boolean
    toolCount: number
    error?: string
    transport: "http" | "stdio"
    needsAuth: boolean
    signedIn: boolean
  }[]
  /** Begin an OAuth sign-in; returns the page to open, or `authorized` when stored tokens work. */
  startAuth(
    name: string,
    redirectUrl: string
  ): Promise<{ authorizationUrl?: string; authorized?: boolean }>
  /** Finish a sign-in from the OAuth callback; returns the server name. */
  finishAuth(state: string, code: string, iss?: string): Promise<string>
  signOut(name: string): Promise<void>
  reconnect(name: string): Promise<void>
  close(): Promise<void>
}

type OAuthFile = Record<string, McpOAuthState & { redirectUrl?: string }>

/** OAuth state of every server in one file, written atomically. */
class OAuthStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  read(): OAuthFile {
    try {
      return JSON.parse(readFileSync(this.#file, "utf8")) as OAuthFile
    } catch {
      return {}
    }
  }

  write(data: OAuthFile) {
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(temporary, this.#file)
  }

  forServer(name: string) {
    return {
      load: () => this.read()[name],
      save: (state: McpOAuthState) => {
        const data = this.read()
        data[name] = { ...data[name], ...state }
        this.write(data)
      },
    }
  }

  redirectUrl(name: string) {
    return this.read()[name]?.redirectUrl
  }

  setRedirectUrl(name: string, redirectUrl: string) {
    const data = this.read()
    data[name] = {
      ...data[name],
      serverUrl: data[name]?.serverUrl ?? "",
      redirectUrl,
    }
    this.write(data)
  }

  remove(name: string) {
    const data = this.read()
    delete data[name]
    this.write(data)
  }
}

const DEFAULT_REDIRECT = "http://127.0.0.1:3141/api/mcp/oauth/callback"

function oauthProvider(
  store: OAuthStore,
  server: Server,
  redirectUrl: string,
  onRedirect: (url: URL) => void = () => undefined
) {
  return new McpOAuthProvider({
    serverUrl: server.config.url!,
    redirectUrl,
    clientMetadata: {
      client_name: "Pico",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    store: store.forServer(server.name),
    onRedirect,
  })
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
      return execSync(value.slice(1), {
        encoding: "utf8",
        timeout: 10_000,
      }).trim()
    } catch {
      return ""
    }
  }
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, name: string) => process.env[name] ?? ""
  )
}

function resolveRecord(record: Record<string, string> | undefined) {
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, resolveValue(value)])
  )
}

function normalizeExposure(value: unknown): Exposure {
  return value === "direct" || value === "hidden" ? value : "codemode"
}

function exposureOf(config: ServerConfig, tool: string): Exposure {
  const overrides = config.toolExposure ?? {}
  if (overrides[tool]) return normalizeExposure(overrides[tool])
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (!pattern.includes("*")) continue
    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`
    )
    if (regex.test(tool)) return normalizeExposure(exposure)
  }
  return normalizeExposure(config.exposure)
}

function readConfig(agentDir: string): Record<string, ServerConfig> {
  for (const path of [join(agentDir, "mcp.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        mcpServers?: Record<string, ServerConfig>
      }
      return parsed.mcpServers ?? {}
    } catch {
      // Try the next location.
    }
  }
  return {}
}

export function createMcpExtension(
  agentDir: string,
  dataDir: string
): McpExtension {
  const servers = readConfigServers(agentDir)
  const store = new OAuthStore(join(dataDir, "mcp-oauth.json"))
  const listeners: Array<() => void> = []
  let extension = build(servers)

  const changed = () => {
    extension = build(servers)
    for (const listener of listeners) listener()
  }

  const start = (server: Server) =>
    connect(server, store).then(changed, (error: unknown) => {
      server.needsAuth = error instanceof McpOAuthAuthorizationRequiredError
      server.error = server.needsAuth
        ? "Sign in to this server in Pico's agent settings"
        : error instanceof Error
          ? error.message
          : String(error)
      console.warn(
        `[pico] MCP server ${server.name} is unavailable: ${server.error}`
      )
    })

  for (const server of servers) {
    if (server.config.enabled === false) continue
    void start(server)
  }

  const find = (name: string) => {
    const server = servers.find((item) => item.name === name)
    if (!server) throw new Error(`Unknown MCP server: ${name}`)
    return server
  }

  const reconnect = async (name: string) => {
    const server = find(name)
    await server.client?.close().catch(() => undefined)
    delete server.client
    server.tools = []
    delete server.error
    delete server.needsAuth
    changed()
    await start(server)
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
          description:
            server.config.description ??
            server.client?.instructions?.split("\n")[0] ??
            `MCP server ${server.name}`,
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
        transport: server.config.url ? ("http" as const) : ("stdio" as const),
        needsAuth: Boolean(server.needsAuth),
        signedIn: Boolean(store.read()[server.name]?.tokens),
      })),
    async startAuth(name, redirectUrl) {
      const server = find(name)
      if (!server.config.url)
        throw new Error(`${name} is not an HTTP server; it cannot use OAuth`)
      if (store.redirectUrl(name) !== redirectUrl) {
        // A client registered for another address cannot use this one.
        const data = store.read()
        if (data[name]) {
          delete data[name].clientInformation
          delete data[name].codeVerifier
          delete data[name].oauthState
          store.write(data)
        }
        store.setRedirectUrl(name, redirectUrl)
      }
      let authorizationUrl: URL | undefined
      const provider = oauthProvider(store, server, redirectUrl, (url) => {
        authorizationUrl = url
      })
      const result = await authorizeMcp(provider, {
        serverUrl: server.config.url,
        skipRefresh: true,
      })
      if (result === "AUTHORIZED") {
        await reconnect(name)
        return { authorized: true }
      }
      if (!authorizationUrl) throw new Error("The server gave no sign-in page")
      return { authorizationUrl: authorizationUrl.href }
    },
    async finishAuth(state, code, iss) {
      const data = store.read()
      const name = Object.keys(data).find(
        (key) => data[key]?.oauthState === state
      )
      if (!name)
        throw new Error("This sign-in is unknown or expired. Start it again.")
      const server = find(name)
      const provider = oauthProvider(
        store,
        server,
        store.redirectUrl(name) ?? DEFAULT_REDIRECT
      )
      const result = await authorizeMcp(provider, {
        serverUrl: server.config.url!,
        authorizationCode: code,
        ...(iss ? { iss } : {}),
      })
      if (result !== "AUTHORIZED") throw new Error("The sign-in did not finish")
      const after = store.read()
      if (after[name]) {
        delete after[name].oauthState
        store.write(after)
      }
      await reconnect(name)
      return name
    },
    async signOut(name) {
      find(name)
      store.remove(name)
      await reconnect(name)
    },
    reconnect,
    async close() {
      for (const server of servers) await server.client?.close()
    },
  }
}

function readConfigServers(agentDir: string): Server[] {
  return Object.entries(readConfig(agentDir)).map(([name, config]) => ({
    name,
    config,
    tools: [],
  }))
}

async function connect(server: Server, store: OAuthStore) {
  const { config } = server
  const client = new McpClient({
    name: "pico",
    version: "3",
    requestTimeoutMs: 120_000,
  })
  const transport = config.url
    ? new StreamableHttpTransport({
        url: config.url,
        ...(config.headers ? { headers: resolveRecord(config.headers) } : {}),
        authProvider: adaptOAuthProvider(
          oauthProvider(
            store,
            server,
            store.redirectUrl(server.name) ?? DEFAULT_REDIRECT
          )
        ),
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
        description:
          tool.description ?? `${tool.name} from MCP server ${server.name}`,
        parameters: (tool.inputSchema ?? {
          type: "object",
          properties: {},
        }) as unknown as TSchema,
        ...(exposure === "codemode" ? { callers: ["tools"] as const } : {}),
        ...(server.config.replaySafe ? { replay: "safe" as const } : {}),
        async execute(args, _api, context) {
          const client = server.client
          if (!client || client.connectionState !== "connected") {
            throw new Error(`MCP server ${server.name} is not connected`)
          }
          const result = await client.callTool(
            tool.name,
            args as Record<string, unknown>,
            context.abortSignal ? { signal: context.abortSignal } : {}
          )
          const content: Array<TextContent | ImageContent> = []
          for (const part of toLlmContent(result)) {
            if (part.type === "text")
              content.push({ type: "text", text: part.text })
            else if (part.type === "image")
              content.push({
                type: "image",
                data: part.data,
                mimeType: part.mimeType,
              })
          }
          return {
            output:
              content.length > 0
                ? content
                : [{ type: "text", text: "(no output)" }],
            ...(result.isError ? { isError: true } : {}),
          }
        },
      })
    }
  }
  return defineExtension({ name: "mcp", tools })
}
