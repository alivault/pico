import { constants } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createTwoFilesPatch } from "diff"

import { resolvePiSdkDir } from "@/server/pi-sdk-path"
import type { PiSdkLike } from "@/server/pi-sdk-types"

type EditOperation = {
  oldText: string
  newText: string
}

type EditInput = {
  path: string
  edits: Array<EditOperation>
}

type EditToolResult = {
  content: Array<{ type: "text"; text: string }>
  details: {
    diff: string
    firstChangedLine?: number
    patch: string
  }
}

type EditToolDefinition = {
  name: string
  execute: (
    toolCallId: string,
    params: EditInput,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown
  ) => Promise<EditToolResult>
  [key: string]: unknown
}

type EditDiffModule = {
  applyEditsToNormalizedContent: (
    normalizedContent: string,
    edits: Array<EditOperation>,
    targetPath: string
  ) => {
    baseContent: string
    newContent: string
  }
  normalizeToLF: (text: string) => string
  detectLineEnding: (content: string) => "\n" | "\r\n"
  generateDiffString: (
    oldContent: string,
    newContent: string
  ) => { diff: string; firstChangedLine?: number }
  restoreLineEndings: (text: string, ending: "\n" | "\r\n") => string
  stripBom: (content: string) => { bom: string; text: string }
}

type PiSdkWithEditTool = PiSdkLike & {
  createEditToolDefinition?: (cwd: string) => EditToolDefinition
  withFileMutationQueue?: <T>(
    filePath: string,
    fn: () => Promise<T>
  ) => Promise<T>
}

let editDiffModulePromise: Promise<EditDiffModule> | undefined

function resolveToCwd(filePath: string, cwd: string) {
  const expanded = filePath.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath === "~"
      ? os.homedir()
      : filePath.startsWith("@")
        ? filePath.slice(1)
        : filePath

  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded)
}

async function getEditDiffModule() {
  // eslint-disable-next-line react-doctor/no-dynamic-import-path -- The edit diff helper is loaded from the runtime-resolved Pi SDK directory.
  editDiffModulePromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      path.join(resolvePiSdkDir(), "dist", "core", "tools", "edit-diff.js")
    ).href
  ) as Promise<EditDiffModule>
  return await editDiffModulePromise
}

function assertNotAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error("Operation aborted")
}

function createPatch(
  input: EditInput,
  baseContent: string,
  newContent: string
) {
  return createTwoFilesPatch(
    input.path,
    input.path,
    baseContent,
    newContent,
    "",
    "",
    { context: 4 }
  ).trimEnd()
}

async function executeEdit(
  cwd: string,
  input: EditInput,
  signal?: AbortSignal
) {
  const editDiff = await getEditDiffModule()
  const absolutePath = resolveToCwd(input.path, cwd)

  assertNotAborted(signal)

  try {
    await access(absolutePath, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error(`File not found: ${input.path}`)
  }

  assertNotAborted(signal)

  const rawContent = await readFile(absolutePath, "utf-8")
  const { bom, text: content } = editDiff.stripBom(rawContent)
  const originalEnding = editDiff.detectLineEnding(content)
  const { baseContent, newContent } = editDiff.applyEditsToNormalizedContent(
    editDiff.normalizeToLF(content),
    input.edits,
    input.path
  )

  assertNotAborted(signal)

  await writeFile(
    absolutePath,
    bom + editDiff.restoreLineEndings(newContent, originalEnding),
    "utf-8"
  )

  assertNotAborted(signal)

  const diff = editDiff.generateDiffString(baseContent, newContent)

  return {
    content: [
      {
        type: "text" as const,
        text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.`,
      },
    ],
    details: {
      diff: diff.diff,
      firstChangedLine: diff.firstChangedLine,
      patch: createPatch(input, baseContent, newContent),
    },
  }
}

export async function createPicoEditToolDefinition(
  sdk: PiSdkLike,
  cwd: string
): Promise<EditToolDefinition | undefined> {
  const sdkWithEdit = sdk as PiSdkWithEditTool
  const factory = sdkWithEdit.createEditToolDefinition
  const queue = sdkWithEdit.withFileMutationQueue
  if (typeof factory !== "function" || typeof queue !== "function") {
    return undefined
  }

  const base = factory(cwd)

  return {
    ...base,
    async execute(_toolCallId, params, signal) {
      const absolutePath = resolveToCwd(params.path, cwd)
      return await queue(absolutePath, () => executeEdit(cwd, params, signal))
    },
  }
}
