/**
 * Links from the conversation to the file viewer. Paths in inline code, in
 * markdown links, and in tool cards become links when the file exists in
 * the agent's folder. The checks go to the server in batches
 * (`/api/files/exists`), and the query cache keeps the answers, so a long
 * conversation sends few requests.
 */
import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import { emitSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useToolRenderContext } from "@/features/smith/tool-renderers/registry"
import {
  formatFileReference,
  splitOutputReferences,
  type FileReference,
} from "@/lib/smith/file-references"
import { useOptionalMachineId } from "@/lib/smith/machine-context"
import { normalizeCwd } from "@/features/smith/right-sidebar-shared"
import { cn } from "@/lib/utils"

/** The agent whose folder the paths are relative to. */
export type FileLinkScope = {
  machineId: string
  viewerContextId: string
  agentId: string
  cwd: string
}

/** The scope of the conversation that shows, or undefined outside one. */
export function useFileLinkScope(): FileLinkScope | undefined {
  const machineId = useOptionalMachineId()
  const { viewerContextId, agentId, cwd } = useToolRenderContext()
  const normalized = cwd ? normalizeCwd(cwd) : ""
  return React.useMemo(
    () =>
      machineId && viewerContextId && agentId && normalized
        ? { machineId, viewerContextId, agentId, cwd: normalized }
        : undefined,
    [agentId, machineId, normalized, viewerContextId]
  )
}

// -----------------------------------------------------------------------------
// Batched checks

/** The most paths in one request; the server refuses more. */
const BATCH_LIMIT = 200
/** Paths that ask in this time go in one request. */
const BATCH_DELAY_MS = 30

type Waiter = {
  resolve: (file: string | null) => void
  reject: (error: unknown) => void
}

type Batch = {
  scope: FileLinkScope
  waiting: Map<string, Array<Waiter>>
}

const batches = new Map<string, Batch>()

function scopeKey(scope: FileLinkScope) {
  return `${scope.machineId}\u0000${scope.viewerContextId}\u0000${scope.cwd}`
}

async function sendBatch(batch: Batch) {
  const entries = [...batch.waiting.entries()]
  for (let start = 0; start < entries.length; start += BATCH_LIMIT) {
    const chunk = entries.slice(start, start + BATCH_LIMIT)
    try {
      const response = await fetchJson<{
        files: Record<string, string | null>
      }>(
        buildRequestUrl("/api/files/exists", {
          machineId: batch.scope.machineId,
          contextId: batch.scope.viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: batch.scope.cwd,
            paths: chunk.map(([path]) => path),
          }),
        }
      )
      for (const [path, waiters] of chunk)
        for (const waiter of waiters)
          waiter.resolve(response.files[path] ?? null)
    } catch (error) {
      for (const [, waiters] of chunk)
        for (const waiter of waiters) waiter.reject(error)
    }
  }
}

/** The file that `path` names in the scope's folder, or null. */
function checkFile(scope: FileLinkScope, path: string) {
  const key = scopeKey(scope)
  let batch = batches.get(key)
  if (!batch) {
    const created: Batch = { scope, waiting: new Map() }
    batch = created
    batches.set(key, created)
    window.setTimeout(() => {
      batches.delete(key)
      void sendBatch(created)
    }, BATCH_DELAY_MS)
  }
  const waiting = batch.waiting
  return new Promise<string | null>((resolve, reject) => {
    const waiters = waiting.get(path) ?? []
    waiters.push({ resolve, reject })
    waiting.set(path, waiters)
  })
}

/**
 * The file that `path` names, as a path from the agent's folder, once the
 * server says it exists. Undefined before that, and for no file.
 */
export function useExistingFile(
  scope: FileLinkScope | undefined,
  path: string | undefined,
  enabled = true
) {
  const query = useQuery({
    queryKey: [
      "smith",
      "file-exists",
      scope?.viewerContextId ?? "",
      scope?.cwd ?? "",
      path ?? "",
    ],
    queryFn: () => checkFile(scope!, path!),
    enabled: Boolean(enabled && scope && path),
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return query.data ?? undefined
}

// -----------------------------------------------------------------------------
// Opening files

/**
 * Open a file of an agent in the file viewer and show its lines. The shell
 * that shows the agent opens it. `pin` opens a pinned tab.
 */
export function openFileInViewer(
  scope: Pick<FileLinkScope, "machineId" | "agentId">,
  reference: FileReference,
  options: { pin?: boolean } = {}
) {
  emitSmithEvent("smith:open-file", {
    machineId: scope.machineId,
    agentId: scope.agentId,
    path: reference.path,
    ...(reference.line ? { line: reference.line } : {}),
    ...(reference.endLine ? { endLine: reference.endLine } : {}),
    ...(options.pin ? { pin: true } : {}),
  })
}

/** Cmd-click (Ctrl-click) opens a pinned tab. */
function pinOf(event: React.MouseEvent | React.KeyboardEvent) {
  return event.metaKey || event.ctrlKey
}

/**
 * Props that make an element a link to a file, or none when the file does
 * not exist (yet). The element stays the same, so the text does not move
 * when the link appears.
 */
export function useFileLinkProps(
  reference: FileReference | undefined,
  options: { enabled?: boolean; stopPropagation?: boolean } = {}
) {
  const scope = useFileLinkScope()
  const file = useExistingFile(scope, reference?.path, options.enabled ?? true)
  if (!scope || !reference || !file) return undefined
  const target = { ...reference, path: file }
  const open = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault()
    if (options.stopPropagation) event.stopPropagation()
    openFileInViewer(scope, target, { pin: pinOf(event) })
  }
  return {
    role: "link",
    tabIndex: 0,
    title: `Open ${formatFileReference(target)} (⌘-click: new tab)`,
    "data-file-link": "true",
    onClick: open,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter") open(event)
    },
  } as const
}

/** The classes of a file link: the text keeps its style. */
export const FILE_LINK_CLASS =
  "cursor-pointer underline-offset-2 decoration-current/60 hover:underline focus-visible:underline focus-visible:outline-none"

/** Text that becomes a link to a file when the file exists. */
export function FileLinkText({
  reference,
  className,
  children,
  stopPropagation,
}: {
  reference: FileReference | undefined
  className?: string
  children: React.ReactNode
  stopPropagation?: boolean
}) {
  const props = useFileLinkProps(reference, { stopPropagation })
  return (
    <span {...props} className={cn(className, props && FILE_LINK_CLASS)}>
      {children}
    </span>
  )
}

/**
 * Tool output with links on the paths of its lines, as `path:line:` of grep
 * and rg, and lines that are only a path.
 */
export function LinkifiedOutput({
  text,
  base,
}: {
  text: string
  base?: string
}) {
  const scope = useFileLinkScope()
  const segments = React.useMemo(
    () => (scope ? splitOutputReferences(text, base) : [{ text }]),
    [base, scope, text]
  )
  return (
    <>
      {segments.map((segment, index) =>
        "reference" in segment ? (
          <FileLinkText key={index} reference={segment.reference}>
            {segment.text}
          </FileLinkText>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      )}
    </>
  )
}
