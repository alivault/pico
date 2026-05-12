import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  GIT_COMMITS_PAGE_SIZE,
  copyGitCommitValue,
  formatGitCommitDetailTime,
  formatGitCommitFullDate,
  gitChangesQueryOptions,
  gitCommitStatCount,
  gitCommitsSummaryText,
  parseGitCommitGraphLine,
} from "@/features/pico/right-sidebar-git-data"
import { GitSection } from "@/features/pico/right-sidebar-git-section"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type { GitScopedProps } from "@/features/pico/right-sidebar-types"

const GIT_GRAPH_LANE_COLORS = [
  "#0ea5e9",
  "#db2777",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
]
const GIT_GRAPH_NULL_VERTEX_ID = -1
const GIT_GRAPH_ROW_HEIGHT = 32
const GIT_GRAPH_COMMIT_DETAILS_HEIGHT = 150
const GIT_GRAPH_LANE_WIDTH = 14
const GIT_GRAPH_OFFSET_X = 12

function gitGraphLaneColor(index: number, active = false) {
  if (active) return "#f87171"
  return GIT_GRAPH_LANE_COLORS[index % GIT_GRAPH_LANE_COLORS.length]
}

type GitCommitGraphParsed = ReturnType<typeof parseGitCommitGraphLine>

type GitCommitGraphPoint = {
  x: number
  y: number
}

type GitCommitGraphLine = {
  p1: GitCommitGraphPoint
  p2: GitCommitGraphPoint
}

type GitCommitGraphRow = {
  colour: number
  commitLane: number
  parsed: GitCommitGraphParsed
}

type GitCommitGraphConnection = {
  connectsTo: GitCommitGraphVertex | null
  onBranch: GitCommitGraphBranch
}

class GitCommitGraphBranch {
  private readonly colour: number
  private readonly lines: Array<GitCommitGraphLine> = []

  constructor(colour: number) {
    this.colour = colour
  }

  addLine(p1: GitCommitGraphPoint, p2: GitCommitGraphPoint) {
    this.lines.push({ p1, p2 })
  }

  getColour() {
    return this.colour
  }

  getLines() {
    return this.lines
  }
}

class GitCommitGraphVertex {
  readonly id: number
  private connections: Array<GitCommitGraphConnection | undefined> = []
  private nextParent = 0
  private nextX = 0
  private onBranch: GitCommitGraphBranch | null = null
  private parents: Array<GitCommitGraphVertex> = []
  private x = 0

  constructor(id: number) {
    this.id = id
  }

  addParent(vertex: GitCommitGraphVertex) {
    this.parents.push(vertex)
  }

  getNextParent() {
    return this.parents[this.nextParent] ?? null
  }

  registerParentProcessed() {
    this.nextParent += 1
  }

  isMerge() {
    return this.parents.length > 1
  }

  addToBranch(branch: GitCommitGraphBranch, x: number) {
    if (this.onBranch !== null) return

    this.onBranch = branch
    this.x = x
  }

  isNotOnBranch() {
    return this.onBranch === null
  }

  getBranch() {
    return this.onBranch
  }

  getPoint(): GitCommitGraphPoint {
    return { x: this.x, y: this.id }
  }

  getNextPoint(): GitCommitGraphPoint {
    return { x: this.nextX, y: this.id }
  }

  getPointConnectingTo(
    vertex: GitCommitGraphVertex | null,
    onBranch: GitCommitGraphBranch
  ) {
    for (let i = 0; i < this.connections.length; i++) {
      const connection = this.connections[i]
      if (
        connection?.connectsTo === vertex &&
        connection.onBranch === onBranch
      ) {
        return { x: i, y: this.id }
      }
    }

    return null
  }

  registerUnavailablePoint(
    x: number,
    connectsToVertex: GitCommitGraphVertex | null,
    onBranch: GitCommitGraphBranch
  ) {
    if (x !== this.nextX) return

    this.nextX = x + 1
    this.connections[x] = { connectsTo: connectsToVertex, onBranch }
  }
}

function buildGitCommitGraphRows(lines: Array<string>) {
  const parsedRows = lines.map((line) => parseGitCommitGraphLine(line))
  const commitLookup = new Map<string, number>()
  parsedRows.forEach((parsed, index) => {
    if (parsed.fullHash) commitLookup.set(parsed.fullHash, index)
  })

  const nullVertex = new GitCommitGraphVertex(GIT_GRAPH_NULL_VERTEX_ID)
  const vertices = parsedRows.map(
    (_parsed, index) => new GitCommitGraphVertex(index)
  )
  const branches: Array<GitCommitGraphBranch> = []
  const availableColours: Array<number> = []

  parsedRows.forEach((parsed, index) => {
    if (!parsed.fullHash) return

    const vertex = vertices[index]!
    parsed.parents.forEach((parentHash) => {
      const parentIndex = commitLookup.get(parentHash)
      if (typeof parentIndex === "number") {
        const parentVertex = vertices[parentIndex]!
        vertex.addParent(parentVertex)
      } else {
        vertex.addParent(nullVertex)
      }
    })
  })

  const getAvailableColour = (startAt: number) => {
    for (let i = 0; i < availableColours.length; i++) {
      if (startAt > (availableColours[i] ?? 0)) return i
    }

    availableColours.push(0)
    return availableColours.length - 1
  }

  const determinePath = (startAt: number) => {
    let i = startAt
    let vertex = vertices[i]!
    let parentVertex = vertex.getNextParent()
    let lastPoint = vertex.isNotOnBranch()
      ? vertex.getNextPoint()
      : vertex.getPoint()

    if (
      parentVertex !== null &&
      parentVertex.id !== GIT_GRAPH_NULL_VERTEX_ID &&
      vertex.isMerge() &&
      !vertex.isNotOnBranch() &&
      !parentVertex.isNotOnBranch()
    ) {
      const parentBranch = parentVertex.getBranch()!
      let processedParent = false

      for (i = startAt + 1; i < vertices.length; i++) {
        const currentVertex = vertices[i]!
        const pointToParent = currentVertex.getPointConnectingTo(
          parentVertex,
          parentBranch
        )
        const currentPoint = pointToParent ?? currentVertex.getNextPoint()
        parentBranch.addLine(lastPoint, currentPoint)
        currentVertex.registerUnavailablePoint(
          currentPoint.x,
          parentVertex,
          parentBranch
        )
        lastPoint = currentPoint

        if (pointToParent !== null) {
          vertex.registerParentProcessed()
          processedParent = true
          break
        }
      }

      if (!processedParent) vertex.registerParentProcessed()
      return
    }

    const branch = new GitCommitGraphBranch(getAvailableColour(startAt))
    vertex.addToBranch(branch, lastPoint.x)
    vertex.registerUnavailablePoint(lastPoint.x, vertex, branch)

    for (i = startAt + 1; i < vertices.length; i++) {
      const currentVertex = vertices[i]!
      const currentPoint =
        parentVertex === currentVertex && !parentVertex.isNotOnBranch()
          ? currentVertex.getPoint()
          : currentVertex.getNextPoint()
      branch.addLine(lastPoint, currentPoint)
      currentVertex.registerUnavailablePoint(
        currentPoint.x,
        parentVertex,
        branch
      )
      lastPoint = currentPoint

      if (parentVertex === currentVertex) {
        vertex.registerParentProcessed()
        const parentVertexOnBranch = !parentVertex.isNotOnBranch()
        parentVertex.addToBranch(branch, currentPoint.x)
        vertex = parentVertex
        parentVertex = vertex.getNextParent()
        if (parentVertex === null || parentVertexOnBranch) break
      }
    }

    if (
      i === vertices.length &&
      parentVertex !== null &&
      parentVertex.id === GIT_GRAPH_NULL_VERTEX_ID
    ) {
      vertex.registerParentProcessed()
    }

    branches.push(branch)
    availableColours[branch.getColour()] = i
  }

  let i = 0
  while (i < vertices.length) {
    const vertex = vertices[i]!
    const parsed = parsedRows[i]!
    if (
      parsed.fullHash &&
      (vertex.getNextParent() !== null || vertex.isNotOnBranch())
    ) {
      determinePath(i)
    } else {
      i += 1
    }
  }

  const rows: Array<GitCommitGraphRow> = parsedRows.map((parsed, index) => {
    const branch = vertices[index]?.getBranch() ?? null
    return {
      colour: branch?.getColour() ?? 0,
      commitLane:
        parsed.fullHash && branch ? vertices[index]!.getPoint().x : -1,
      parsed,
    }
  })
  const maxLaneCount = Math.max(
    1,
    ...vertices.map((vertex) => vertex.getNextPoint().x)
  )

  return { branches, maxLaneCount, rows }
}

function gitCommitGraphRowValue(row: GitCommitGraphRow, index: number) {
  return row.parsed.fullHash || `commit-row:${index}`
}

function gitCommitGraphRowHeights(
  rows: Array<GitCommitGraphRow>,
  openCommitValues: Array<string>
) {
  const openCommitValueSet = new Set(openCommitValues)

  return rows.map((row, index) =>
    openCommitValueSet.has(gitCommitGraphRowValue(row, index))
      ? GIT_GRAPH_ROW_HEIGHT + GIT_GRAPH_COMMIT_DETAILS_HEIGHT
      : GIT_GRAPH_ROW_HEIGHT
  )
}

function gitCommitGraphRowTops(rowHeights: Array<number>) {
  let top = 0
  return rowHeights.map((height) => {
    const rowTop = top
    top += height
    return rowTop
  })
}

function gitCommitGraphTotalHeight(rowHeights: Array<number>) {
  return rowHeights.reduce((total, height) => total + height, 0)
}

function gitCommitGraphRowCenter(rowTops: Array<number>, rowIndex: number) {
  return (
    (rowTops[rowIndex] ?? rowIndex * GIT_GRAPH_ROW_HEIGHT) +
    GIT_GRAPH_ROW_HEIGHT / 2
  )
}

function gitCommitGraphSegmentPath({
  line,
  rowTops,
}: {
  line: GitCommitGraphLine
  rowTops: Array<number>
}) {
  const x1 = line.p1.x * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
  const y1 = gitCommitGraphRowCenter(rowTops, line.p1.y)
  const x2 = line.p2.x * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
  const y2 = gitCommitGraphRowCenter(rowTops, line.p2.y)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`

  const d = GIT_GRAPH_ROW_HEIGHT * 0.8
  return `M ${x1} ${y1} C ${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`
}

function GitCommitPageGraph({
  lines,
  openCommitValues,
  unpushedCommitShortHashes,
}: {
  lines: Array<string>
  openCommitValues: Array<string>
  unpushedCommitShortHashes: Set<string>
}) {
  const { branches, maxLaneCount, rows } = buildGitCommitGraphRows(lines)
  const rowHeights = gitCommitGraphRowHeights(rows, openCommitValues)
  const rowTops = gitCommitGraphRowTops(rowHeights)
  const width = Math.max(24, maxLaneCount * GIT_GRAPH_LANE_WIDTH + 4)
  const height = Math.max(
    GIT_GRAPH_ROW_HEIGHT,
    gitCommitGraphTotalHeight(rowHeights)
  )
  const paths: Array<React.ReactElement> = []
  const circles: Array<React.ReactElement> = []

  branches.forEach((branch, branchIndex) => {
    branch.getLines().forEach((line, lineIndex) => {
      paths.push(
        <path
          key={`path:${branchIndex}:${lineIndex}`}
          d={gitCommitGraphSegmentPath({ line, rowTops })}
          fill="none"
          stroke={gitGraphLaneColor(branch.getColour())}
          strokeLinecap="round"
          strokeWidth="2"
        />
      )
    })
  })

  rows.forEach((row, rowIndex) => {
    if (row.commitLane < 0) return

    const x = row.commitLane * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_OFFSET_X
    const y = gitCommitGraphRowCenter(rowTops, rowIndex)
    const active = Boolean(
      row.parsed.hash && unpushedCommitShortHashes.has(row.parsed.hash)
    )
    circles.push(
      <circle
        key={`circle:${rowIndex}:${row.parsed.fullHash}`}
        cx={x}
        cy={y}
        r="4"
        fill={gitGraphLaneColor(row.colour, active)}
      />
    )
  })

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      style={{ width, height }}
    >
      {paths}
      {circles}
    </svg>
  )
}

function GitCommitRow({
  graphWidth,
  line,
  value,
}: {
  graphWidth: number
  line: string
  value: string
}) {
  const parsed = parseGitCommitGraphLine(line)
  const [hashCopied, setHashCopied] = React.useState(false)
  const hashCopiedResetRef = React.useRef<number | undefined>(undefined)
  const title = parsed.subject.trim()
  const time = formatGitCommitDetailTime(parsed.relativeDate)
  const fullTime = formatGitCommitFullDate(parsed.fullDate)
  const insertions = gitCommitStatCount(parsed.stats, "insertions")
  const deletions = gitCommitStatCount(parsed.stats, "deletions")
  const shortHash = parsed.hash || parsed.fullHash.slice(0, 7)
  React.useEffect(() => {
    return () => {
      if (typeof hashCopiedResetRef.current === "number") {
        window.clearTimeout(hashCopiedResetRef.current)
      }
    }
  }, [])

  const copyFullHashInline = () => {
    if (!parsed.fullHash) return

    void copyGitCommitValue(parsed.fullHash).then((copied) => {
      if (!copied) return
      setHashCopied(true)
      if (typeof hashCopiedResetRef.current === "number") {
        window.clearTimeout(hashCopiedResetRef.current)
      }
      hashCopiedResetRef.current = window.setTimeout(() => {
        setHashCopied(false)
      }, 1200)
    })
  }

  if (!parsed.hash && !parsed.subject) {
    return (
      <div className="flex h-8 max-w-full min-w-0 items-center font-mono text-[13px] leading-5">
        {parsed.subject ? (
          <span className="min-w-0 flex-1 truncate text-foreground">
            {parsed.subject}
          </span>
        ) : null}
      </div>
    )
  }

  const trigger = (
    <AccordionTrigger
      headerClassName="min-w-0"
      className="h-8 min-h-8 w-full items-center gap-2 rounded-none px-1.5 py-0 font-mono text-[13px] leading-5 font-normal transition-colors hover:bg-muted/50 hover:text-foreground hover:no-underline focus-visible:ring-0 aria-expanded:bg-muted aria-expanded:text-foreground **:data-[slot=accordion-trigger-icon]:size-4"
    >
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        style={{ paddingLeft: graphWidth }}
      >
        {title || parsed.hash || "Commit"}
      </span>
    </AccordionTrigger>
  )

  return (
    <AccordionItem value={value} className="border-0">
      <ContextMenu>
        <ContextMenuTrigger render={trigger} />
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            disabled={!parsed.fullHash}
            onClick={() => {
              void copyGitCommitValue(parsed.fullHash)
            }}
          >
            <CopyIcon />
            Copy commit hash
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!parsed.subject}
            onClick={() => {
              void copyGitCommitValue(parsed.subject)
            }}
          >
            <CopyIcon />
            Copy commit message
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AccordionContent className="h-[150px] overflow-y-auto border-b border-border/70 bg-muted/20 pr-2 pb-2">
        <div
          className="grid content-start gap-1.5 pt-1 font-mono text-xs leading-4"
          style={{ paddingLeft: graphWidth }}
        >
          {parsed.author || time ? (
            <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              {parsed.author ? <span>{parsed.author}</span> : null}
              {parsed.author && time ? <span aria-hidden>·</span> : null}
              {time ? (
                <TitleTooltip title={fullTime} side="top">
                  <span>{time}</span>
                </TitleTooltip>
              ) : null}
            </div>
          ) : null}
          <div className="max-w-full break-words whitespace-normal text-foreground">
            {title || "No commit message"}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-emerald-500">
              +{insertions} addition{insertions === 1 ? "" : "s"}
            </span>
            <span className="text-red-400">
              -{deletions} deletion{deletions === 1 ? "" : "s"}
            </span>
          </div>
          {parsed.fullHash ? (
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="min-w-0 truncate">{shortHash}</span>
              <button
                type="button"
                aria-label="Copy full commit hash"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  copyFullHashInline()
                }}
              >
                {hashCopied ? (
                  <CheckIcon className="size-3.5 text-emerald-500" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
              </button>
            </div>
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

function GitCommitRows({
  lines,
  unpushedCommitShortHashes,
}: {
  lines: Array<string>
  unpushedCommitShortHashes: Set<string>
}) {
  const { maxLaneCount, rows } = buildGitCommitGraphRows(lines)
  const graphWidth = Math.max(24, maxLaneCount * GIT_GRAPH_LANE_WIDTH + 4)
  const rowValues = rows.map((row, index) => gitCommitGraphRowValue(row, index))
  const [openCommitValues, setOpenCommitValues] = React.useState<Array<string>>(
    []
  )
  const visibleOpenCommitValues = openCommitValues.filter((value) =>
    rowValues.includes(value)
  )
  const rowHeights = gitCommitGraphRowHeights(rows, visibleOpenCommitValues)

  return (
    <div className="relative min-w-0">
      <GitCommitPageGraph
        lines={lines}
        openCommitValues={visibleOpenCommitValues}
        unpushedCommitShortHashes={unpushedCommitShortHashes}
      />
      <Accordion
        multiple
        value={visibleOpenCommitValues}
        onValueChange={(values) => {
          setOpenCommitValues(values.slice(-1))
        }}
        className="grid min-w-0 gap-0"
      >
        {lines.map((line, index) => (
          <div
            key={`${index}:${line}`}
            className="min-w-0"
            style={{
              minHeight: rowHeights[index] ?? GIT_GRAPH_ROW_HEIGHT,
            }}
          >
            <GitCommitRow
              graphWidth={graphWidth}
              line={line}
              value={rowValues[index] ?? `${index}`}
            />
          </div>
        ))}
      </Accordion>
    </div>
  )
}

export function GitCommitsSection({
  viewerContextId,
  cwd,
  active,
  embedded = false,
  flush = false,
}: GitScopedProps & {
  embedded?: boolean
  flush?: boolean
}) {
  const normalizedCwd = normalizeCwd(cwd)
  const [commitsLimit, setCommitsLimit] = React.useState(GIT_COMMITS_PAGE_SIZE)
  const commitsLoadMoreRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    setCommitsLimit(GIT_COMMITS_PAGE_SIZE)
  }, [normalizedCwd])
  const commitsScopeQueryKey = picoQueryKeys.gitCommits(
    viewerContextId,
    normalizedCwd
  )
  const commitsQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: normalizedCwd,
      scope: "commits",
      commitsLimit,
    }),
    enabled: Boolean(active && viewerContextId && normalizedCwd),
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey
      const sameCommitScope = commitsScopeQueryKey.every(
        (part, index) => previousKey?.[index] === part
      )
      return sameCommitScope ? previousData : undefined
    },
    notifyOnChangeProps: ["data", "isFetching", "isPending", "error"],
  })
  const commitsData = commitsQuery.data
  const commits = commitsData?.commits
  const commitsHasMore = Boolean(commitsData?.commitsHasMore)
  const meta = Array.isArray(commits) ? gitCommitsSummaryText(commits) : ""
  const unpushedCommitShortHashes = new Set(
    commitsData?.unpushedCommitShortHashes ?? []
  )
  React.useEffect(() => {
    const target = commitsLoadMoreRef.current
    if (
      !target ||
      !active ||
      !commitsHasMore ||
      commitsQuery.isFetching ||
      typeof IntersectionObserver === "undefined"
    ) {
      return
    }

    let requestedNextPage = false
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || requestedNextPage) return

        requestedNextPage = true
        setCommitsLimit((value) => value + GIT_COMMITS_PAGE_SIZE)
      },
      { rootMargin: "320px 0px" }
    )
    observer.observe(target)

    return () => observer.disconnect()
  }, [active, commitsHasMore, commitsQuery.isFetching, normalizedCwd])
  const content = !normalizedCwd ? (
    <GitSectionNote className="px-3 py-2.5">
      No directory selected.
    </GitSectionNote>
  ) : !viewerContextId ? (
    <GitSectionNote className="px-3 py-2.5">
      Waiting for viewer context…
    </GitSectionNote>
  ) : (commitsQuery.isPending && typeof commits === "undefined") ||
    (commitsQuery.isFetching && commits === null) ? (
    <GitSectionNote className="px-3 py-2.5">
      <Spinner /> Loading commits…
    </GitSectionNote>
  ) : commitsQuery.error ? (
    <GitSectionNote tone="destructive" className="px-3 py-2.5">
      {getErrorMessage(commitsQuery.error, "Failed to load commits")}
    </GitSectionNote>
  ) : commits === null ? (
    <GitSectionNote className="px-3 py-2.5">
      No git repository detected.
    </GitSectionNote>
  ) : Array.isArray(commits) && commits.length > 0 ? (
    <div className="grid min-w-0 gap-3">
      <GitCommitRows
        lines={commits}
        unpushedCommitShortHashes={unpushedCommitShortHashes}
      />
      {commitsHasMore ? (
        <div ref={commitsLoadMoreRef} className="flex">
          <button
            type="button"
            className="inline-flex h-8 w-fit items-center justify-center rounded-md border border-border/80 bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={commitsQuery.isFetching}
            onClick={() => {
              setCommitsLimit((value) => value + GIT_COMMITS_PAGE_SIZE)
            }}
          >
            {commitsQuery.isFetching ? "Loading more…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  ) : (
    <GitSectionNote className="px-3 py-2.5">
      No commits on this branch yet.
    </GitSectionNote>
  )

  if (embedded) {
    return <div className="grid min-w-0 gap-2 overflow-x-hidden">{content}</div>
  }

  if (flush) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <div className="text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase">
              History
            </div>
            {meta ? (
              <div className="min-w-0 truncate text-xs text-muted-foreground/80">
                {meta}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid min-h-0 min-w-0 flex-1 gap-2 overflow-x-hidden overflow-y-auto">
          {content}
        </div>
      </section>
    )
  }

  return (
    <GitSection
      title="Commits"
      meta={meta}
      className="overflow-x-hidden"
      bodyClassName="min-w-0 overflow-x-hidden p-0"
    >
      {content}
    </GitSection>
  )
}
