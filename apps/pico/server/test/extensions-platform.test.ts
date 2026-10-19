import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

import { applyProfile, findProfile } from "../src/core/profiles.ts"
import { createMcpExtension } from "../src/extensions/mcp.ts"
import { createTodoExtension } from "../src/extensions/todo.ts"
import { createRenderExtension } from "../src/extensions/render.ts"
import { ctx, openHarness, tempDir, TEST_MODEL } from "./support.ts"

void test("profiles select extensions and remove tools", async () => {
  const dir = await tempDir()
  const todo = createTodoExtension()
  const render = createRenderExtension()
  const { createCodingTools } = await import("@earendil-works/pi-durable/tools")
  const coding = createCodingTools()
  const harness = await openHarness(
    join(dir, "db.sqlite"),
    [coding, render, todo],
    () => ({ text: "ok" }),
    dir
  )
  try {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: TEST_MODEL } },
      ctx
    )
    const registry = {
      snapshot: () => {
        const extensions = [coding, render, todo]
        return {
          installed: () => extensions,
          extension: (name: string) =>
            extensions.find((extension) => extension.name === name),
          tools: () =>
            extensions.flatMap((extension) =>
              (extension.tools ?? []).map((tool) => ({ tool, extension }))
            ),
        }
      },
      subscribe: () => () => undefined,
    } as never
    const names = async () =>
      (await conversation.agent(ctx)).tools.map((tool) => tool.name).sort()
    assert.ok((await names()).includes("bash"))
    await applyProfile(conversation, registry, findProfile("read-only"), ctx)
    const readOnly = await names()
    assert.ok(readOnly.includes("read"))
    assert.ok(readOnly.includes("bash"))
    assert.ok(!readOnly.includes("write"))
    assert.ok(!readOnly.includes("edit"))
    assert.match(
      (await conversation.agent(ctx)).instructions ?? "",
      /read-only/
    )
    await applyProfile(
      conversation,
      registry,
      findProfile("narrow", {
        narrow: { description: "Only todo", extensions: ["todo"] },
      }),
      ctx
    )
    assert.deepEqual(await names(), ["todo"])
    await applyProfile(conversation, registry, undefined, ctx)
    assert.ok((await names()).includes("write"))
    assert.equal((await conversation.agent(ctx)).instructions, undefined)
  } finally {
    await harness.close(ctx)
  }
})

/** A fake MCP server behind OAuth: discovery, registration, PKCE, tokens. */
async function fakeOAuthMcp() {
  let base = ""
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", base)
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      const json = (status: number, value: unknown, headers = {}) => {
        response.writeHead(status, {
          "content-type": "application/json",
          ...headers,
        })
        response.end(JSON.stringify(value))
      }
      if (
        url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
        url.pathname === "/.well-known/oauth-protected-resource"
      )
        return json(200, {
          resource: `${base}/mcp`,
          authorization_servers: [base],
        })
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
        })
      if (url.pathname === "/register") {
        const metadata = JSON.parse(body) as Record<string, unknown>
        return json(201, { ...metadata, client_id: "client-1" })
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(body)
        if (params.get("code") !== "good-code" || !params.get("code_verifier"))
          return json(400, { error: "invalid_grant" })
        return json(200, {
          access_token: "token-1",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-1",
        })
      }
      if (url.pathname === "/mcp") {
        if (request.headers.authorization !== "Bearer token-1")
          return json(
            401,
            { error: "unauthorized" },
            {
              "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            }
          )
        if (request.method !== "POST") {
          response.writeHead(405)
          response.end()
          return
        }
        const message = JSON.parse(body) as { id?: number; method: string }
        if (message.id === undefined) {
          response.writeHead(202)
          response.end()
          return
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "fake", version: "1" },
              }
            : message.method === "tools/list"
              ? { tools: [{ name: "hello", inputSchema: { type: "object" } }] }
              : {}
        return json(
          200,
          { jsonrpc: "2.0", id: message.id, result },
          {
            "mcp-session-id": "s1",
          }
        )
      }
      json(404, { error: "not found" })
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  )
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  return { server, base }
}

void test("MCP OAuth signs in from the callback and connects", async () => {
  const dir = await tempDir()
  const { server, base } = await fakeOAuthMcp()
  const agentDir = join(dir, "agent")
  await mkdir(agentDir)
  await writeFile(
    join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: { secure: { url: `${base}/mcp`, exposure: "direct" } },
    })
  )
  const mcp = createMcpExtension(agentDir, dir)
  try {
    const waitFor = async (check: () => boolean) => {
      const deadline = Date.now() + 5000
      while (!check()) {
        if (Date.now() > deadline) throw new Error(JSON.stringify(mcp.status()))
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    await waitFor(() => mcp.status()[0]!.needsAuth)
    const started = await mcp.startAuth(
      "secure",
      "http://127.0.0.1:3141/api/mcp/oauth/callback"
    )
    const authorization = new URL(started.authorizationUrl!)
    assert.equal(authorization.pathname, "/authorize")
    assert.equal(authorization.searchParams.get("client_id"), "client-1")
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256"
    )
    await assert.rejects(
      mcp.finishAuth("wrong-state", "good-code"),
      /unknown or expired/
    )
    const name = await mcp.finishAuth(
      authorization.searchParams.get("state")!,
      "good-code"
    )
    assert.equal(name, "secure")
    await waitFor(() => mcp.status()[0]!.connected)
    assert.equal(mcp.status()[0]!.signedIn, true)
    assert.deepEqual(
      (mcp.extension.tools ?? []).map((tool) => tool.name),
      ["mcp__secure__hello"]
    )
  } finally {
    await mcp.close()
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
})
