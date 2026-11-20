/**
 * The card of the `open_file` tool (server extensions/open-file.ts): the
 * file and its lines, the agent's note, and an Open button that shows the
 * file in the viewer again, also long after the call.
 */
import { FileSymlinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { openFileInViewer, useFileLinkScope } from "@/features/smith/file-links"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/smith/tool-renderers/registry"
import { formatFileReference } from "@/lib/smith/file-references"

type OpenFileDetails = {
  cwd: string
  path: string
  line: number
  endLine: number
  note: string
}

function OpenFileCard({ block, fallback }: ToolRendererProps) {
  const scope = useFileLinkScope()
  const details = toolDetails<OpenFileDetails>(block)
  if (block.isError || !details.path) return <>{fallback}</>
  const reference = {
    // The path is relative to the folder of the call. When the agent's
    // folder changed after it, the viewer opens the absolute path.
    path:
      details.cwd && scope && details.cwd !== scope.cwd
        ? `${details.cwd.replace(/\/+$/, "")}/${details.path}`
        : details.path,
    ...(details.line ? { line: details.line } : {}),
    ...(details.endLine ? { endLine: details.endLine } : {}),
  }
  const label = formatFileReference({ ...reference, path: details.path })
  const note = details.note ?? toolArgs(block).note
  return (
    <div
      data-conversation-row="true"
      className="flex max-w-full min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
    >
      <FileSymlinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium whitespace-nowrap">Opened</span>
      <span className="min-w-0 truncate font-mono text-[0.92em] text-foreground">
        {label}
      </span>
      {typeof note === "string" && note ? (
        <span className="min-w-0 truncate">· {note}</span>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="ml-1 shrink-0"
        disabled={!scope}
        onClick={(event) => {
          if (scope)
            openFileInViewer(scope, reference, {
              pin: event.metaKey || event.ctrlKey,
            })
        }}
      >
        Open
      </Button>
    </div>
  )
}

registerToolRenderer("open_file", {
  Card: OpenFileCard,
  summary: (block) => {
    const details = toolDetails<OpenFileDetails>(block)
    const args = toolArgs(block)
    const path =
      details.path ?? (typeof args.path === "string" ? args.path : "")
    return path
      ? formatFileReference({
          path,
          line:
            details.line ??
            (typeof args.line === "number" ? args.line : undefined),
          endLine:
            details.endLine ??
            (typeof args.end_line === "number" ? args.end_line : undefined),
        })
      : ""
  },
})
