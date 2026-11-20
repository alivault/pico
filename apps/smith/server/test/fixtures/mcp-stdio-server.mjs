// A tiny MCP server on stdio for tests. Usage:
//   node mcp-stdio-server.mjs <pid log file> <tool name>...
// It appends its process ID to the log file, gives `pid <id>` as its
// instructions, and has one tool for each name, which answers with the name.
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const [log, ...tools] = process.argv.slice(2)
if (log) appendFileSync(log, `${process.pid}\n`)

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const { id, method, params } = message
  if (method === "initialize")
    send({
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
        instructions: `pid ${process.pid}`,
      },
    })
  else if (method === "tools/list")
    send({
      id,
      result: {
        tools: tools.map((name) => ({
          name,
          inputSchema: { type: "object", properties: {} },
        })),
      },
    })
  else if (method === "tools/call")
    send({
      id,
      result: { content: [{ type: "text", text: params.name }] },
    })
  else if (method === "ping") send({ id, result: {} })
  else send({ id, error: { code: -32601, message: `no method ${method}` } })
})
