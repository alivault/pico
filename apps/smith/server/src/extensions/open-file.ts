/**
 * The `open-file` extension: the `open_file` tool shows a file, or lines of
 * it, in the user's file viewer (the Files tab of the right sidebar).
 *
 * The tool only reads: it checks that the file is inside the agent's folder,
 * as the file viewer does, and sends an `open_file` event. A client that
 * shows the agent opens the file, or shows a notice with a button; the tool
 * card in the conversation keeps an Open button for later.
 */
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import Type from "typebox"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

import { projectFileInside } from "../services/files.ts"
import { agentIdOf, type HostBridge } from "./host.ts"
import { cwdOf, errorResult, textResult } from "./util.ts"

export type OpenFileEvent = {
  type: "open_file"
  agentId: string
  /** The agent's folder; `path` is relative to it. */
  cwd: string
  path: string
  line?: number
  endLine?: number
  note?: string
  /** The tool call, so a client opens one call one time. */
  callId: string
}

export type OpenFileTarget = {
  path: string
  line?: number
  endLine?: number
  note?: string
}

/** Files up to this size get their lines counted, to check `line`. */
const COUNT_LIMIT = 5_000_000
const NOTE_LIMIT = 200

function lineNumber(value: unknown, name: string) {
  if (value === undefined || value === null) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${name} must be a whole number from 1`)
  return number
}

/**
 * Check the arguments of `open_file` for an agent in `cwd`. Returns the file
 * as a path from `cwd` with its line range, or throws with a message for
 * the model.
 */
export async function resolveOpenFile(
  cwd: string,
  args: { path?: unknown; line?: unknown; end_line?: unknown; note?: unknown }
): Promise<OpenFileTarget> {
  const requested = typeof args.path === "string" ? args.path.trim() : ""
  if (!requested) throw new Error("path is required")
  const line = lineNumber(args.line, "line")
  let endLine = lineNumber(args.end_line, "end_line")
  if (endLine !== undefined && line === undefined)
    throw new Error("end_line needs line")
  if (line !== undefined && endLine !== undefined && endLine < line)
    throw new Error("end_line must not be before line")
  if (endLine === line) endLine = undefined

  const path = await projectFileInside(cwd, requested)
  if (!path) {
    const absolute = isAbsolute(requested)
      ? requested
      : join(cwd, requested.replace(/^\.\//, ""))
    const info = await stat(absolute).catch(() => undefined)
    if (!info) throw new Error(`File not found: ${requested}`)
    if (!info.isFile()) throw new Error(`Not a file: ${requested}`)
    throw new Error(
      `${requested} is outside this agent's folder (${cwd}). The file viewer shows only files inside it.`
    )
  }

  if (line !== undefined) {
    const absolute = join(cwd, path)
    const info = await stat(absolute)
    if (info.size <= COUNT_LIMIT) {
      const text = await readFile(absolute, "utf8")
      const lines = text.endsWith("\n")
        ? text.split("\n").length - 1
        : text.split("\n").length
      const last = endLine ?? line
      if (last > Math.max(1, lines))
        throw new Error(
          `${path} has ${lines} line${lines === 1 ? "" : "s"}; line ${last} is after its end`
        )
    }
  }

  const note =
    typeof args.note === "string"
      ? args.note.replace(/\s+/g, " ").trim().slice(0, NOTE_LIMIT)
      : ""
  return {
    path,
    ...(line !== undefined ? { line } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
    ...(note ? { note } : {}),
  }
}

/** `path:10` or `path:10-20`. */
export function formatFileTarget(target: OpenFileTarget) {
  if (target.line === undefined) return target.path
  return target.endLine !== undefined
    ? `${target.path}:${target.line}-${target.endLine}`
    : `${target.path}:${target.line}`
}

export function createOpenFileExtension(host: HostBridge) {
  const openFileTool = defineTool({
    name: "open_file",
    description: [
      "Open a file in the user's file viewer in Smith, and jump to a line or a range of lines, which the viewer highlights.",
      "Use it to show the user a specific place: the change you made, the line of a log or an error, the code that you talk about.",
      "Do not use it for each file that you read. It does not give you the content; use read for that.",
      "The file must be inside your working directory. path is relative to it, or absolute.",
      "note is one short line that the user sees with the file.",
    ].join(" "),
    parameters: Type.Object({
      path: Type.String({
        description: "The file, relative to the working directory or absolute",
      }),
      line: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "First line to show (1-based)",
        })
      ),
      end_line: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "Last line of the range to highlight",
        })
      ),
      note: Type.Optional(
        Type.String({
          description: "One short line for the user, for example 'the fix'",
        })
      ),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const cwd = await cwdOf(api, context)
      let target: OpenFileTarget
      try {
        target = await resolveOpenFile(cwd, args as Record<string, unknown>)
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error)
        )
      }
      const services = await host.ready(context.abortSignal)
      const own = agentIdOf(api.conversationId)
      const agentId = services.agents.current(own) ?? own
      const event: OpenFileEvent = {
        type: "open_file",
        agentId,
        cwd,
        callId: api.callId,
        ...target,
      }
      services.events.push(event, { agentId })
      return textResult(
        `Sent ${formatFileTarget(target)} to the user's file viewer. It opens when the user looks at this agent; the user can also open it from this tool call.`,
        { details: { cwd, ...target } }
      )
    },
  })

  return defineExtension({ name: "open-file", tools: [openFileTool] })
}
