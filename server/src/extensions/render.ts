/**
 * The `render` extension: `show` draws rich output in the web client. The
 * payload goes to the client in the result's `details`; the model sees only
 * a short summary.
 */
import { readFile, stat } from "node:fs/promises"
import { extname, isAbsolute, resolve } from "node:path"

import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

import { cwdOf, errorResult, textResult } from "./util.ts"

export const SHOW_KINDS = [
  "mermaid",
  "chart",
  "table",
  "html",
  "markdown",
  "image",
  "diff",
] as const

export type ShowKind = (typeof SHOW_KINDS)[number]

const MAX_DETAILS_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

type Table = {
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
}

/** A table from `{ columns, rows }`, rows of objects, or CSV text. */
export function normalizeTable(data: unknown): Table {
  if (typeof data === "string") {
    const trimmed = data.trim()
    if (trimmed.startsWith("[") || trimmed.startsWith("{"))
      return normalizeTable(JSON.parse(trimmed))
    const lines = trimmed.split(/\r?\n/).filter(Boolean)
    const split = (line: string) => line.split(line.includes("\t") ? "\t" : ",")
    const [header = "", ...rest] = lines
    return { columns: split(header), rows: rest.map(split) }
  }
  if (Array.isArray(data)) {
    if (data.every((row) => Array.isArray(row))) {
      const [header = [], ...rows] = data as unknown[][]
      return {
        columns: header.map(String),
        rows: rows.map((row) => row.map(cell)),
      }
    }
    const columns = [
      ...new Set(
        data.flatMap((row) =>
          row && typeof row === "object" ? Object.keys(row) : []
        )
      ),
    ]
    return {
      columns,
      rows: data.map((row) =>
        columns.map((column) =>
          cell((row as Record<string, unknown> | null)?.[column])
        )
      ),
    }
  }
  if (data && typeof data === "object") {
    const value = data as { columns?: unknown; rows?: unknown }
    if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
      const columns = (value.columns as unknown[]).map(String)
      return {
        columns,
        rows: (value.rows as unknown[]).map((row) =>
          Array.isArray(row)
            ? row.map(cell)
            : columns.map((column) =>
                cell((row as Record<string, unknown>)[column])
              )
        ),
      }
    }
  }
  throw new Error(
    "A table needs { columns, rows }, an array of objects, or CSV text"
  )
}

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (["string", "number", "boolean"].includes(typeof value))
    return value as string | number | boolean
  return JSON.stringify(value)
}

const showTool = defineTool({
  name: "show",
  description: [
    "Show rich output to the user in the web client: a Mermaid diagram, a Vega-Lite chart, a table, an HTML page (sandboxed), markdown, an image file, or a unified diff.",
    "You get only a short confirmation back, so use it to present results, not to read them.",
    "data: mermaid source; a Vega-Lite spec (object or JSON); a table as { columns, rows }, an array of objects, or CSV; HTML; markdown; or a patch. For an image, give path (or a URL in data).",
  ].join(" "),
  parameters: Type.Object({
    kind: Type.Union(SHOW_KINDS.map((kind) => Type.Literal(kind))),
    title: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
    path: Type.Optional(
      Type.String({ description: "A file to show, for images or text kinds" })
    ),
  }),
  replay: "safe",
  async execute(args, api, context) {
    const kind = args.kind as ShowKind
    let data: unknown = args.data
    try {
      if (args.path) {
        const cwd = await cwdOf(api, context)
        const path = isAbsolute(args.path) ? args.path : resolve(cwd, args.path)
        if (kind === "image") {
          const info = await stat(path)
          if (info.size > MAX_IMAGE_BYTES)
            return errorResult(
              `The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
            )
          const type = IMAGE_TYPES[extname(path).toLowerCase()]
          if (!type) return errorResult(`Not a supported image type: ${path}`)
          data = `data:${type};base64,${(await readFile(path)).toString("base64")}`
        } else {
          data = await readFile(path, "utf8")
        }
      }
      if (data === undefined || data === null || data === "")
        return errorResult("show needs data or path")
      if (kind === "chart" && typeof data === "string") data = JSON.parse(data)
      if (kind === "table") data = normalizeTable(data)
      if (
        ["mermaid", "html", "markdown", "diff"].includes(kind) &&
        typeof data !== "string"
      )
        return errorResult(`${kind} data must be text`)
    } catch (error) {
      return errorResult(
        `Could not prepare the ${kind}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const details = { kind, ...(args.title ? { title: args.title } : {}), data }
    const size = Buffer.byteLength(JSON.stringify(details))
    const limit = kind === "image" ? MAX_IMAGE_BYTES * 1.4 : MAX_DETAILS_BYTES
    if (size > limit)
      return errorResult(
        `The ${kind} is too large to show (${Math.round(size / 1024)} KB). Make it smaller.`
      )
    return textResult(`Shown ${kind}${args.title ? `: ${args.title}` : ""}.`, {
      details: details as never,
    })
  },
})

export function createRenderExtension() {
  return defineExtension({ name: "render", tools: [showTool] })
}
