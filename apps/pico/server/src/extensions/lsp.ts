/**
 * The `lsp` extension: code intelligence through language servers.
 *
 * Diagnostics, definitions, references, hover, symbols, and rename, for
 * TypeScript and JavaScript (a server ships with Pico), Python, Rust, and Go.
 * Positions are 1-based lines and columns, or a symbol name on a line.
 *
 * With the `lspAfterEdit` setting, an `afterTool` hook adds the new errors of
 * a file to the result of `edit` and `write`.
 */
import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  hook,
  ToolTask,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable"

import {
  applyWorkspaceEdit,
  languageOf,
  LspPool,
  uriToPath,
  type Diagnostic,
  type Location,
  type Position,
  type WorkspaceEdit,
} from "../services/lsp.ts"
import type { HostBridge } from "./host.ts"
import {
  clip,
  cwdOf,
  deniedAction,
  errorResult,
  runCommand,
  textResult,
} from "./util.ts"

const SEVERITY = ["", "error", "warning", "info", "hint"]
const MAX_RESULTS = 100

/** A 0-based position from 1-based line and column, or a symbol on a line. */
export function findPosition(
  text: string,
  options: { line?: number; column?: number; symbol?: string }
): Position {
  const lines = text.split("\n")
  if (options.symbol) {
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_$])${options.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`
    )
    const search = options.line
      ? [options.line - 1]
      : lines.map((_, index) => index)
    for (const index of search) {
      const match = pattern.exec(lines[index] ?? "")
      if (match) return { line: index, character: match.index }
    }
    throw new Error(
      `${options.symbol} was not found${options.line ? ` on line ${options.line}` : ""}`
    )
  }
  if (!options.line) throw new Error("Give line (and column) or symbol")
  return {
    line: options.line - 1,
    character: Math.max(0, (options.column ?? 1) - 1),
  }
}

function lineText(text: string, line: number) {
  return (text.split("\n")[line] ?? "").trim()
}

export function formatDiagnostics(
  path: string,
  diagnostics: Diagnostic[],
  minimum = 4
) {
  return diagnostics
    .filter((item) => (item.severity ?? 1) <= minimum)
    .map(
      (item) =>
        `${path}:${item.range.start.line + 1}:${item.range.start.character + 1} ${SEVERITY[item.severity ?? 1] ?? "error"}${item.code !== undefined ? ` ${item.code}` : ""}: ${item.message}`
    )
}

async function changedFiles(cwd: string) {
  const tracked = await runCommand(["git", "diff", "--name-only", "HEAD"], {
    cwd,
  })
  const untracked = await runCommand(
    ["git", "ls-files", "--others", "--exclude-standard"],
    { cwd }
  )
  const top = await runCommand(["git", "rev-parse", "--show-toplevel"], { cwd })
  const root = top.stdout.trim() || cwd
  return [
    ...new Set(
      [...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")]
        .map((line) => line.trim())
        .filter(Boolean)
        .map((file) => resolve(root, file))
    ),
  ]
}

async function describeLocations(locations: Location[], cwd: string) {
  const texts = new Map<string, string>()
  const lines: string[] = []
  for (const location of locations.slice(0, MAX_RESULTS)) {
    const path = uriToPath(location.uri)
    if (!texts.has(path))
      texts.set(path, await readFile(path, "utf8").catch(() => ""))
    const start = location.range.start
    lines.push(
      `${relative(cwd, path) || path}:${start.line + 1}:${start.character + 1}  ${lineText(texts.get(path)!, start.line)}`
    )
  }
  if (locations.length > MAX_RESULTS)
    lines.push(`…and ${locations.length - MAX_RESULTS} more`)
  return lines.join("\n")
}

function asLocations(result: unknown): Location[] {
  if (!result) return []
  const list = Array.isArray(result) ? result : [result]
  return list.flatMap((item) => {
    const value = item as {
      uri?: string
      range?: Location["range"]
      targetUri?: string
      targetSelectionRange?: Location["range"]
    }
    if (value.uri && value.range)
      return [{ uri: value.uri, range: value.range }]
    if (value.targetUri && value.targetSelectionRange)
      return [{ uri: value.targetUri, range: value.targetSelectionRange }]
    return []
  })
}

function hoverText(result: unknown) {
  const contents = (result as { contents?: unknown } | null)?.contents
  const part = (value: unknown): string =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map(part).join("\n\n")
        : ((value as { value?: string } | undefined)?.value ?? "")
  return part(contents).trim()
}

type SymbolInfo = {
  name: string
  kind: number
  location?: Location
  range?: Location["range"]
  containerName?: string
  children?: SymbolInfo[]
}

const SYMBOL_KINDS = [
  "",
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum member",
  "struct",
  "event",
  "operator",
  "type parameter",
]

export function createLspExtension(host: HostBridge) {
  const pool = new LspPool()

  const fileArgs = {
    path: Type.String(),
    line: Type.Optional(Type.Number({ description: "1-based line" })),
    column: Type.Optional(Type.Number({ description: "1-based column" })),
    symbol: Type.Optional(
      Type.String({ description: "A name on the line, instead of a column" })
    ),
  }

  const open = async (
    api: ToolExecutionApi,
    context: Context,
    path: string
  ) => {
    const cwd = await cwdOf(api, context)
    const file = isAbsolute(path) ? path : resolve(cwd, path)
    const client = await pool.client(file, cwd)
    const { uri, text } = await client.sync(file)
    return { cwd, file, client, uri, text }
  }

  type LspArgs = {
    path: string
    paths?: string[] | undefined
    line?: number | undefined
    column?: number | undefined
    symbol?: string | undefined
    query?: string | undefined
    new_name: string
    include_declaration?: boolean | undefined
    errors_only?: boolean | undefined
  }

  const fail = (error: unknown) =>
    errorResult(error instanceof Error ? error.message : String(error))

  const diagnostics = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const cwd = await cwdOf(api, context)
        const files = (
          args.paths?.length
            ? args.paths.map((path) =>
                isAbsolute(path) ? path : resolve(cwd, path)
              )
            : await changedFiles(cwd)
        )
          .filter((file) => languageOf(file))
          .slice(0, 30)
        if (files.length === 0)
          return textResult("No supported files to check.")
        const lines: string[] = []
        let count = 0
        for (const file of files) {
          const client = await pool.client(file, cwd)
          const diagnostics = await client.diagnostics(file)
          const formatted = formatDiagnostics(
            relative(cwd, file) || file,
            diagnostics,
            args.errors_only ? 1 : 2
          )
          count += formatted.length
          lines.push(...formatted)
        }
        return textResult(
          count === 0
            ? `No problems in ${files.length} file(s).`
            : `${count} problem(s) in ${files.length} file(s):\n${clip(lines.join("\n"), 30_000)}`
        )
      } catch (error) {
        return fail(error)
      }
    }
  }

  const definition = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const { cwd, client, uri, text } = await open(api, context, args.path)
        const position = findPosition(text, args)
        const result = await client.request("textDocument/definition", {
          textDocument: { uri },
          position,
        })
        const locations = asLocations(result)
        return textResult(
          locations.length
            ? await describeLocations(locations, cwd)
            : "No definition found."
        )
      } catch (error) {
        return fail(error)
      }
    }
  }

  const references = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const { cwd, client, uri, text } = await open(api, context, args.path)
        const position = findPosition(text, args)
        const result = await client.request("textDocument/references", {
          textDocument: { uri },
          position,
          context: { includeDeclaration: args.include_declaration ?? true },
        })
        const locations = asLocations(result)
        return textResult(
          locations.length
            ? `${locations.length} reference(s):\n${await describeLocations(locations, cwd)}`
            : "No references found."
        )
      } catch (error) {
        return fail(error)
      }
    }
  }

  const hover = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const { client, uri, text } = await open(api, context, args.path)
        const position = findPosition(text, args)
        const result = await client.request("textDocument/hover", {
          textDocument: { uri },
          position,
        })
        return textResult(hoverText(result) || "No information.")
      } catch (error) {
        return fail(error)
      }
    }
  }

  const symbols = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const { cwd, client, uri } = await open(api, context, args.path)
        if (args.query) {
          const result = (await client.request("workspace/symbol", {
            query: args.query,
          })) as SymbolInfo[] | null
          const items = (result ?? []).slice(0, MAX_RESULTS)
          return textResult(
            items.length
              ? items
                  .map(
                    (item) =>
                      `${SYMBOL_KINDS[item.kind] ?? "symbol"} ${item.name}${item.containerName ? ` in ${item.containerName}` : ""} — ${item.location ? `${relative(cwd, uriToPath(item.location.uri))}:${item.location.range.start.line + 1}` : ""}`
                  )
                  .join("\n")
              : "No symbols found."
          )
        }
        const result = (await client.request("textDocument/documentSymbol", {
          textDocument: { uri },
        })) as SymbolInfo[] | null
        const lines: string[] = []
        const walk = (items: SymbolInfo[], depth: number) => {
          for (const item of items) {
            const range = item.range ?? item.location?.range
            lines.push(
              `${"  ".repeat(depth)}${SYMBOL_KINDS[item.kind] ?? "symbol"} ${item.name}${range ? ` :${range.start.line + 1}` : ""}`
            )
            if (item.children) walk(item.children, depth + 1)
          }
        }
        walk(result ?? [], 0)
        return textResult(
          lines.length ? clip(lines.join("\n"), 20_000) : "No symbols."
        )
      } catch (error) {
        return fail(error)
      }
    }
  }

  const rename = async (
    args: LspArgs,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    {
      try {
        const { cwd, client, uri, text } = await open(api, context, args.path)
        const position = findPosition(text, args)
        const edit = (await client.request("textDocument/rename", {
          textDocument: { uri },
          position,
          newName: args.new_name,
        })) as WorkspaceEdit | null
        if (!edit)
          return errorResult("The language server cannot rename this symbol.")
        const files = await applyWorkspaceEdit(edit)
        for (const file of files) await client.sync(file).catch(() => undefined)
        return textResult(
          `Renamed to ${args.new_name} in ${files.length} file(s):\n${files.map((file) => relative(cwd, file) || file).join("\n")}`,
          { details: { files } }
        )
      } catch (error) {
        return fail(error)
      }
    }
  }

  const ACTIONS = {
    diagnostics,
    definition,
    references,
    hover,
    symbols,
    rename,
  }

  const lspTool = defineTool({
    name: "lsp",
    deferred: true,
    description: [
      "Ask the language server. Actions:",
      "diagnostics (type errors and warnings for paths, default the files changed in git; errors_only);",
      "definition, references (include_declaration), hover: of the symbol at a position (path and line, with column or symbol);",
      "symbols (the symbols of path, or with query a search in the project);",
      "rename (rename the symbol at a position to new_name everywhere; changes files on disk).",
    ].join(" "),
    parameters: Type.Object({
      action: Type.Union(
        Object.keys(ACTIONS).map((name) => Type.Literal(name))
      ),
      path: Type.Optional(Type.String()),
      paths: Type.Optional(Type.Array(Type.String())),
      line: fileArgs.line,
      column: fileArgs.column,
      symbol: fileArgs.symbol,
      query: Type.Optional(Type.String()),
      new_name: Type.Optional(Type.String()),
      include_declaration: Type.Optional(Type.Boolean()),
      errors_only: Type.Optional(Type.Boolean()),
    }),
    async execute(args, api, context) {
      const action = String(args.action) as keyof typeof ACTIONS
      const run = ACTIONS[action]
      if (!run) return errorResult(`Unknown action: ${action}`)
      if (action !== "diagnostics" && !args.path)
        return errorResult(`${action} needs path.`)
      if (action === "rename") {
        if (!args.new_name) return errorResult("rename needs new_name.")
        const denied = deniedAction(host, api.conversationId, "lsp.rename")
        if (denied) return denied
      }
      return run(args as LspArgs, api, context)
    },
  })

  const afterEdit = hook(ToolTask, {
    afterTool: async (call, result, hookApi) => {
      if (!host.current?.settings().lspAfterEdit) return undefined
      if (call.parent || result.isError) return undefined
      if (call.name !== "edit" && call.name !== "write") return undefined
      const path = (call.arguments as { path?: unknown }).path
      if (typeof path !== "string" || !languageOf(path)) return undefined
      try {
        const services = host.current
        const session = `s${hookApi.conversationId}`
        const cwd = services?.sessions.has(session)
          ? services.sessions.meta(session).cwd
          : process.cwd()
        const file = isAbsolute(path) ? path : resolve(cwd, path)
        const client = await pool.client(file, cwd)
        const errors = formatDiagnostics(
          relative(cwd, file) || file,
          await client.diagnostics(file, 8000),
          1
        )
        if (errors.length === 0) return undefined
        return {
          ...result,
          output: [
            ...(result.output ?? []),
            {
              type: "text",
              text: `\nThe language server reports ${errors.length} error(s) in this file now:\n${clip(errors.slice(0, 20).join("\n"), 4000)}`,
            },
          ],
        }
      } catch {
        return undefined
      }
    },
  })

  return {
    pool,
    extension: defineExtension({
      name: "lsp",
      tools: [lspTool],
      hooks: [afterEdit],
    }),
  }
}
