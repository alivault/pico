import * as React from "react"
import { parsePatchFiles } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { ExternalLinkIcon } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { ImageLightbox } from "@/features/pico/image-lightbox"
import { MarkdownBlock } from "@/features/pico/markdown-renderer"
import { usePicoDiffThemeOptions } from "@/features/pico/pico-diff-theme"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { machineApiUrl } from "@/lib/pico/machine"
import { useMachineId } from "@/lib/pico/machine-context"
import { cn } from "@/lib/utils"

const MermaidView = React.lazy(
  () => import("@/features/pico/tool-renderers/mermaid-view")
)
const VegaView = React.lazy(
  () => import("@/features/pico/tool-renderers/vega-view")
)

type ShowDetails = {
  kind: "mermaid" | "chart" | "table" | "html" | "markdown" | "image" | "diff"
  title?: string
  data: unknown
}

type Table = {
  columns: Array<string>
  rows: Array<Array<string | number | boolean | null>>
}

function TableView({ table }: { table: Table }) {
  const [sort, setSort] = React.useState<{ column: number; asc: boolean }>()
  const rows = React.useMemo(() => {
    if (!sort) return table.rows
    return [...table.rows].sort((left, right) => {
      const a = left[sort.column]
      const b = right[sort.column]
      const result =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a ?? "").localeCompare(String(b ?? ""), undefined, {
              numeric: true,
            })
      return sort.asc ? result : -result
    })
  }, [sort, table.rows])
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {table.columns.map((column, index) => (
              <th
                key={`${column}:${index}`}
                aria-sort={
                  sort?.column === index
                    ? sort.asc
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className="px-1 py-1 text-left font-medium whitespace-nowrap"
              >
                <button
                  type="button"
                  className="rounded px-1 py-0.5 outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() =>
                    setSort((current) =>
                      current?.column === index
                        ? { column: index, asc: !current.asc }
                        : { column: index, asc: true }
                    )
                  }
                >
                  {column}
                  {sort?.column === index ? (sort.asc ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t">
              {row.map((value, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "px-2 py-1 align-top",
                    typeof value === "number" && "text-right tabular-nums"
                  )}
                >
                  {value === null ? "" : String(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HtmlView({ html, title }: { html: string; title?: string }) {
  const url = React.useMemo(
    () => URL.createObjectURL(new Blob([html], { type: "text/html" })),
    [html]
  )
  React.useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="space-y-1">
      <iframe
        title={title ?? "HTML preview"}
        // Scripts run, but without the Pico origin: no same-origin access.
        sandbox="allow-scripts allow-forms allow-popups"
        srcDoc={html}
        className="h-96 w-full resize-y rounded-md border bg-white"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3" /> Open in a new tab
      </a>
    </div>
  )
}

export function DiffView({ patch }: { patch: string }) {
  const themeOptions = usePicoDiffThemeOptions()
  // An agent can send a patch with more than one file, or text that is not a
  // patch. PatchDiff throws on both, so parse here and show each file.
  const fileDiffs = React.useMemo(() => {
    try {
      return parsePatchFiles(patch).flatMap((parsed) => parsed.files)
    } catch {
      return []
    }
  }, [patch])
  if (fileDiffs.length === 0) {
    return (
      <pre className="max-h-96 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
        {patch}
      </pre>
    )
  }
  return (
    <div className="space-y-2">
      {fileDiffs.map((fileDiff, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-md border bg-background text-xs"
        >
          <FileDiff
            fileDiff={fileDiff}
            disableWorkerPool
            options={{
              ...themeOptions,
              diffStyle: "unified",
              lineDiffType: "word-alt",
              maxLineDiffLength: 1000,
              overflow: "wrap",
            }}
          />
        </div>
      ))}
    </div>
  )
}

function ImageView({ src: data, title }: { src: string; title?: string }) {
  // The server gives a saved image as a path on its machine.
  const src = machineApiUrl(useMachineId(), data)
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Show ${title ?? "the image"} larger`}
        className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={title ?? "Image"}
          loading="lazy"
          decoding="async"
          className="max-h-96 max-w-full rounded-md border object-contain"
        />
      </button>
      {open ? (
        <ImageLightbox
          imageAlt={title ?? "Image"}
          imageSrc={src}
          onOpenChange={setOpen}
          open={open}
          title={title ?? "Image"}
        />
      ) : null}
    </>
  )
}

export function ShowContent({ details }: { details: ShowDetails }) {
  const { kind, data, title } = details
  const fallback = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner size="xs" /> Loading…
    </div>
  )
  switch (kind) {
    case "mermaid":
      return (
        <React.Suspense fallback={fallback}>
          <MermaidView source={String(data)} />
        </React.Suspense>
      )
    case "chart":
      return (
        <React.Suspense fallback={fallback}>
          <VegaView spec={data} />
        </React.Suspense>
      )
    case "table":
      return <TableView table={data as Table} />
    case "html":
      return <HtmlView html={String(data)} title={title} />
    case "markdown":
      return <MarkdownBlock text={String(data)} />
    case "image":
      return <ImageView src={String(data)} title={title} />
    case "diff":
      return <DiffView patch={String(data)} />
    default:
      return null
  }
}

function ShowCard({ block }: ToolRendererProps) {
  const details = toolDetails<ShowDetails>(block)
  const args = toolArgs(block)
  const title = details.title ?? (args.title as string | undefined)
  return (
    <div className="space-y-2 rounded-xl border bg-muted/10 p-3 text-sm">
      {title ? <div className="font-medium">{title}</div> : null}
      {block.running ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size="xs" /> Preparing{" "}
          {typeof args.kind === "string" ? args.kind : "output"}…
        </div>
      ) : block.isError || !details.kind ? (
        <pre className="text-xs whitespace-pre-wrap text-destructive">
          {block.output || "Nothing to show."}
        </pre>
      ) : (
        <ShowContent details={details as ShowDetails} />
      )}
    </div>
  )
}

registerToolRenderer("show", { Card: ShowCard })
