import * as React from "react"
import { flushSync } from "react-dom"
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  TagIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import {
  hasRemainingScrollContent,
  hasScrolledContent,
  setDerivedScrollState,
} from "@/features/pico/scroll-shadow-utils"
import {
  GIT_COMMITS_PAGE_SIZE,
  copyGitCommitValue,
  formatGitCommitDetailTime,
  formatGitCommitFullDate,
  gitChangesQueryOptions,
  gitCommitStatCount,
  gitFileStatusCharacters,
  gitFileStatusTone,
  gitFileStatusToneClass,
  gitCommitsSummaryText,
  invalidateGitQueries,
  parseGitCommitGraphLine,
} from "@/features/pico/right-sidebar-git-data"
import { GitSection } from "@/features/pico/right-sidebar-git-section"
import { GitSectionNote } from "@/features/pico/right-sidebar-section-note"
import {
  getErrorMessage,
  normalizeCwd,
} from "@/features/pico/right-sidebar-shared"
import type {
  GitCommitDiffTabRequest,
  GitScopedProps,
} from "@/features/pico/right-sidebar-types"
import type {
  GitActionResponse,
  GitCommitDiffMode,
  GitCommitFile,
  GitCommitFilesResponse,
  GitCommitRemoteUrlResponse,
} from "@/lib/pico/api"
import { cn } from "@/lib/utils"

type GitCommitRemoteUrlData = Extract<GitCommitRemoteUrlResponse, { ok: true }>
type GitCommitFilesData = Extract<GitCommitFilesResponse, { ok: true }>

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
const GIT_GRAPH_COMMIT_DETAILS_HEIGHT = 300
const GIT_GRAPH_LANE_WIDTH = 14
const GIT_GRAPH_OFFSET_X = 12

type GitCommitAction =
  | "checkout"
  | "cherry-pick"
  | "revert"
  | "tag"
  | "reset"
  | "rebase"
  | "drop"
  | "squash"

type GitResetMode = "soft" | "mixed" | "hard"

type GitCommitActionRequest = {
  action: GitCommitAction
  commit: string
  label: string
  tagName?: string
  resetMode?: GitResetMode
  message?: string
}

type GitCommitConfirmState = GitCommitActionRequest & {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
}

type GitCommitFormState =
  | { kind: "branch"; title: string; description: string; value: string }
  | { kind: "tag"; title: string; description: string; value: string }
  | { kind: "squash"; title: string; description: string; value: string }

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

function sanitizeGitNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function defaultGitBranchName(subject: string, shortHash: string) {
  const subjectSlug = sanitizeGitNamePart(subject)
  return `commit/${subjectSlug || shortHash}`
}

function defaultGitTagName(shortHash: string) {
  return `v-${shortHash}`
}

function commitActionToastLabel(action: GitCommitAction) {
  switch (action) {
    case "checkout":
      return "Checked out commit"
    case "cherry-pick":
      return "Cherry-picked commit"
    case "revert":
      return "Reverted commit"
    case "tag":
      return "Tagged commit"
    case "reset":
      return "Reset branch"
    case "rebase":
      return "Rebased branch"
    case "drop":
      return "Dropped commit"
    case "squash":
      return "Squashed commits"
  }
}

function GitCommitPageGraph({
  lines,
  openCommitValues,
  unpushedCommitHashes,
}: {
  lines: Array<string>
  openCommitValues: Array<string>
  unpushedCommitHashes: Set<string>
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
      row.parsed.fullHash && unpushedCommitHashes.has(row.parsed.fullHash)
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

type GitCommitActionsProps = {
  disabled: boolean
  busy: boolean
  canCopyMessage: boolean
  onViewDiff: () => void
  onCompareHead: () => void
  onComparePrevious: () => void
  onCopyHash: () => void
  onCopyMessage: () => void
  onCreateBranch: () => void
  onCheckout: () => void
  onCherryPick: () => void
  onRevert: () => void
  onTag: () => void
  onOpenRemote: () => void
  onReset: (mode: GitResetMode) => void
  onRebase: () => void
  onDrop: () => void
  onSquash: () => void
}

function GitCommitActionsMenu({
  disabled,
  busy,
  canCopyMessage,
  onViewDiff,
  onCompareHead,
  onComparePrevious,
  onCopyHash,
  onCopyMessage,
  onCreateBranch,
  onCheckout,
  onCherryPick,
  onRevert,
  onTag,
  onOpenRemote,
  onReset,
  onRebase,
  onDrop,
  onSquash,
}: GitCommitActionsProps) {
  const [open, setOpen] = React.useState(false)
  const [menuKey, setMenuKey] = React.useState(0)
  const actionsRef = React.useRef<{
    close: () => void
    unmount: () => void
  } | null>(null)
  const runAndClose = (action: () => void) => {
    actionsRef.current?.close()
    flushSync(() => {
      setOpen(false)
      setMenuKey((key) => key + 1)
    })
    action()
  }

  return (
    <DropdownMenu
      key={menuKey}
      open={open}
      onOpenChange={setOpen}
      actionsRef={actionsRef}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            aria-label="Commit actions"
            disabled={disabled || busy}
          />
        }
      >
        {busy ? <Spinner className="size-3" /> : <MoreHorizontalIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Commit</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onViewDiff)}
          >
            <FileDiffIcon />
            View diff
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onCompareHead)}
          >
            <FileDiffIcon />
            Compare with HEAD
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onComparePrevious)}
          >
            <FileDiffIcon />
            Compare with previous commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onOpenRemote)}
          >
            <ExternalLinkIcon />
            Open on remote
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onCopyHash)}
          >
            <CopyIcon />
            Copy commit hash
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canCopyMessage}
            onClick={() => runAndClose(onCopyMessage)}
          >
            <CopyIcon />
            Copy commit message
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onCreateBranch)}
          >
            <GitBranchIcon />
            Create branch from commit…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onCheckout)}
          >
            Checkout commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onCherryPick)}
          >
            Cherry-pick commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onRevert)}
          >
            Revert commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onTag)}
          >
            <TagIcon />
            Tag commit…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Dangerous</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(() => onReset("soft"))}
          >
            Reset soft to commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(() => onReset("mixed"))}
          >
            Reset mixed to commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            variant="destructive"
            onClick={() => runAndClose(() => onReset("hard"))}
          >
            Reset hard to commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => runAndClose(onRebase)}
          >
            Rebase onto this commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            variant="destructive"
            onClick={() => runAndClose(onDrop)}
          >
            Drop commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            variant="destructive"
            onClick={() => runAndClose(onSquash)}
          >
            Squash commits after this…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GitCommitActionsContextMenuContent({
  disabled,
  busy,
  canCopyMessage,
  onViewDiff,
  onCompareHead,
  onComparePrevious,
  onCopyHash,
  onCopyMessage,
  onCreateBranch,
  onCheckout,
  onCherryPick,
  onRevert,
  onTag,
  onOpenRemote,
  onReset,
  onRebase,
  onDrop,
  onSquash,
  runAction,
}: GitCommitActionsProps & { runAction: (action: () => void) => void }) {
  const actionDisabled = disabled || busy

  return (
    <ContextMenuContent className="w-64">
      <ContextMenuGroup>
        <ContextMenuLabel>Commit</ContextMenuLabel>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onViewDiff)}
        >
          <FileDiffIcon />
          View diff
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onCompareHead)}
        >
          <FileDiffIcon />
          Compare with HEAD
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onComparePrevious)}
        >
          <FileDiffIcon />
          Compare with previous commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onOpenRemote)}
        >
          <ExternalLinkIcon />
          Open on remote
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onCopyHash)}
        >
          <CopyIcon />
          Copy commit hash
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canCopyMessage || busy}
          onClick={() => runAction(onCopyMessage)}
        >
          <CopyIcon />
          Copy commit message
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onCreateBranch)}
        >
          <GitBranchIcon />
          Create branch from commit…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onCheckout)}
        >
          Checkout commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onCherryPick)}
        >
          Cherry-pick commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onRevert)}
        >
          Revert commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onTag)}
        >
          <TagIcon />
          Tag commit…
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuLabel>Dangerous</ContextMenuLabel>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(() => onReset("soft"))}
        >
          Reset soft to commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(() => onReset("mixed"))}
        >
          Reset mixed to commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          variant="destructive"
          onClick={() => runAction(() => onReset("hard"))}
        >
          Reset hard to commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          onClick={() => runAction(onRebase)}
        >
          Rebase onto this commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          variant="destructive"
          onClick={() => runAction(onDrop)}
        >
          Drop commit
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled}
          variant="destructive"
          onClick={() => runAction(onSquash)}
        >
          Squash commits after this…
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

function gitCommitFileLineChangeValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function GitCommitFileStatus({ status }: { status: string | undefined }) {
  const [indexCharacter, worktreeCharacter] = gitFileStatusCharacters(status)
  const characters = `${indexCharacter}${worktreeCharacter}`.trim()

  return (
    <span className="inline-flex w-[2ch] shrink-0 items-center whitespace-pre text-muted-foreground/70">
      {(
        [
          ["index", indexCharacter],
          ["worktree", worktreeCharacter],
        ] as const
      ).map(([column, character]) => (
        <span
          key={column}
          className={cn(
            "w-[1ch] text-center whitespace-pre",
            gitFileStatusToneClass(gitFileStatusTone(column, character))
          )}
        >
          {character || (characters ? " " : "·")}
        </span>
      ))}
    </span>
  )
}

function GitCommitFileDiffStats({ file }: { file: GitCommitFile }) {
  const linesAdded = gitCommitFileLineChangeValue(file.linesAdded)
  const linesDeleted = gitCommitFileLineChangeValue(file.linesDeleted)

  if (linesAdded === 0 && linesDeleted === 0) return null

  return (
    <span className="inline-flex min-w-0 gap-2 justify-self-end whitespace-nowrap tabular-nums">
      {linesAdded > 0 ? (
        <span className="text-emerald-500">+{linesAdded}</span>
      ) : null}
      {linesDeleted > 0 ? (
        <span className="text-red-500">-{linesDeleted}</span>
      ) : null}
    </span>
  )
}

function GitCommitFilesList({
  viewerContextId,
  cwd,
  commit,
  shortHash,
  previousShortHash,
  subject,
  disabled,
  onOpenCommitDiff,
}: {
  viewerContextId: string
  cwd: string
  commit: string
  shortHash: string
  previousShortHash: string
  subject: string
  disabled: boolean
  onOpenCommitDiff?: (request: GitCommitDiffTabRequest) => void
}) {
  const filesQuery = useQuery({
    queryKey: commit
      ? picoQueryKeys.gitCommitFiles(viewerContextId, cwd, commit)
      : ["pico", "git-commit-files", viewerContextId, cwd, ""],
    queryFn: () =>
      fetchJson<GitCommitFilesData>(
        buildRequestUrl(
          `/api/git-commit-files?cwd=${encodeURIComponent(cwd)}&commit=${encodeURIComponent(
            commit
          )}`,
          { contextId: viewerContextId }
        )
      ),
    enabled: Boolean(!disabled && viewerContextId && cwd && commit),
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const files = filesQuery.data?.files ?? []

  if (filesQuery.isPending && !filesQuery.data) {
    return (
      <GitSectionNote className="px-2 py-1.5">
        <Spinner /> Loading changed files…
      </GitSectionNote>
    )
  }

  if (filesQuery.error) {
    return (
      <GitSectionNote tone="destructive" className="px-2 py-1.5">
        {getErrorMessage(filesQuery.error, "Failed to load changed files")}
      </GitSectionNote>
    )
  }

  if (files.length === 0) return null

  return (
    <div className="grid gap-1 pt-1">
      <div className="font-sans text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
        Changed files
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border/70 bg-background/60">
        {files.map((file) => (
          <button
            key={`${file.previousPath || ""}:${file.path}`}
            type="button"
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-border/60 px-2 py-1.5 text-left last:border-b-0 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            disabled={disabled}
            onClick={() => {
              onOpenCommitDiff?.({
                commit,
                shortHash,
                subject,
                mode: "commit",
                path: file.path,
                previousPath: file.previousPath,
                leftRevisionLabel: previousShortHash || `${shortHash}^`,
                rightRevisionLabel: shortHash,
              })
            }}
          >
            <GitCommitFileStatus status={file.status} />
            <span className="min-w-0 truncate">
              {file.previousPath ? (
                <>
                  <span className="text-muted-foreground">
                    {file.previousPath}
                  </span>
                  <span className="text-muted-foreground/70"> → </span>
                  <span>{file.path}</span>
                </>
              ) : (
                file.path
              )}
            </span>
            <span className="inline-flex min-w-0 items-center gap-2 justify-self-end">
              <GitCommitFileDiffStats file={file} />
              <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function GitCommitRow({
  viewerContextId,
  cwd,
  graphWidth,
  line,
  value,
  onOpenCommitDiff,
}: {
  viewerContextId: string
  cwd: string
  graphWidth: number
  line: string
  value: string
  onOpenCommitDiff?: (request: GitCommitDiffTabRequest) => void
}) {
  const parsed = parseGitCommitGraphLine(line)
  const queryClient = useQueryClient()
  const [hashCopied, setHashCopied] = React.useState(false)
  const [messageCopied, setMessageCopied] = React.useState(false)
  const [formDialog, setFormDialog] = React.useState<GitCommitFormState | null>(
    null
  )
  const [confirmDialog, setConfirmDialog] =
    React.useState<GitCommitConfirmState | null>(null)
  const hashCopiedResetRef = React.useRef<number | undefined>(undefined)
  const messageCopiedResetRef = React.useRef<number | undefined>(undefined)
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false)
  const [contextMenuKey, setContextMenuKey] = React.useState(0)
  const [commitBodyHeaderShadowed, setCommitBodyHeaderShadowed] =
    React.useState(false)
  const [commitBodyFooterShadowed, setCommitBodyFooterShadowed] =
    React.useState(false)
  const commitBodyScrollRef = React.useRef<HTMLDivElement>(null)
  const contextMenuActionsRef = React.useRef<{
    close: () => void
    unmount: () => void
  } | null>(null)
  const title = parsed.subject.trim()
  const time = formatGitCommitDetailTime(parsed.relativeDate)
  const fullTime = formatGitCommitFullDate(parsed.fullDate)
  const insertions = gitCommitStatCount(parsed.stats, "insertions")
  const deletions = gitCommitStatCount(parsed.stats, "deletions")
  const shortHash = parsed.hash || parsed.fullHash.slice(0, 7)
  const canRunCommitAction = Boolean(viewerContextId && cwd && parsed.fullHash)

  React.useEffect(() => {
    setDerivedScrollState<boolean>(setCommitBodyHeaderShadowed, false)
    setDerivedScrollState<boolean>(setCommitBodyFooterShadowed, false)
  }, [value])

  const updateCommitBodyScrollShadows = (
    scrollElement: HTMLDivElement | null
  ) => {
    setDerivedScrollState(
      setCommitBodyHeaderShadowed,
      hasScrolledContent(scrollElement)
    )
    setDerivedScrollState(
      setCommitBodyFooterShadowed,
      hasRemainingScrollContent(scrollElement)
    )
  }

  React.useLayoutEffect(() => {
    updateCommitBodyScrollShadows(commitBodyScrollRef.current)
  })

  React.useEffect(() => {
    return () => {
      if (typeof hashCopiedResetRef.current === "number") {
        window.clearTimeout(hashCopiedResetRef.current)
      }
      if (typeof messageCopiedResetRef.current === "number") {
        window.clearTimeout(messageCopiedResetRef.current)
      }
    }
  }, [])

  const gitCommitActionMutation = useMutation({
    mutationFn: async (request: GitCommitActionRequest) => {
      return await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-commit-action", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, ...request }),
        }
      )
    },
    onSuccess: async (_response, request) => {
      await invalidateGitQueries({ queryClient, viewerContextId, cwd })
      toast.success(request.label || commitActionToastLabel(request.action))
    },
    onError: (error, request) => {
      toast.error(getErrorMessage(error, `Failed to ${request.label}`))
    },
  })

  const createBranchMutation = useMutation({
    mutationFn: async (branch: string) => {
      return await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd,
            branch,
            create: true,
            startPoint: parsed.fullHash,
          }),
        }
      )
    },
    onSuccess: async () => {
      await invalidateGitQueries({ queryClient, viewerContextId, cwd })
      toast.success("Created and checked out branch")
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to create branch"))
    },
  })

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

  const copyCommitMessageInline = () => {
    if (!title) return

    void copyGitCommitValue(title).then((copied) => {
      if (!copied) return
      setMessageCopied(true)
      if (typeof messageCopiedResetRef.current === "number") {
        window.clearTimeout(messageCopiedResetRef.current)
      }
      messageCopiedResetRef.current = window.setTimeout(() => {
        setMessageCopied(false)
      }, 1200)
    })
  }

  const openDiff = (mode: GitCommitDiffMode) => {
    if (!parsed.fullHash) return

    onOpenCommitDiff?.({
      commit: parsed.fullHash,
      shortHash,
      subject: title,
      mode,
    })
  }

  const openRemoteCommit = () => {
    if (!parsed.fullHash) return

    const url = buildRequestUrl(
      `/api/git-commit-remote-url?cwd=${encodeURIComponent(
        cwd
      )}&commit=${encodeURIComponent(parsed.fullHash)}`,
      { contextId: viewerContextId }
    )
    void fetchJson<GitCommitRemoteUrlData>(url)
      .then((response) => {
        window.open(response.remoteUrl, "_blank", "noopener,noreferrer")
      })
      .catch((error) => {
        toast.error(getErrorMessage(error, "Failed to open remote commit"))
      })
  }

  const runConfirmedAction = () => {
    if (!confirmDialog) return
    gitCommitActionMutation.mutate(confirmDialog)
    setConfirmDialog(null)
  }

  const submitFormAction = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formDialog || !parsed.fullHash) return

    const value = formDialog.value.trim()
    if (!value) return

    if (formDialog.kind === "branch") {
      createBranchMutation.mutate(value)
    } else if (formDialog.kind === "tag") {
      gitCommitActionMutation.mutate({
        action: "tag",
        commit: parsed.fullHash,
        tagName: value,
        label: "Tagged commit",
      })
    } else {
      gitCommitActionMutation.mutate({
        action: "squash",
        commit: parsed.fullHash,
        message: value,
        label: "Squashed commits",
      })
    }
    setFormDialog(null)
  }

  const showConfirm = (state: GitCommitConfirmState) => {
    setConfirmDialog(state)
  }

  const showResetConfirm = (resetMode: GitResetMode) => {
    if (!parsed.fullHash) return

    showConfirm({
      action: "reset",
      commit: parsed.fullHash,
      resetMode,
      label: `Reset branch (${resetMode})`,
      title: `Reset branch to ${shortHash}?`,
      description:
        resetMode === "hard"
          ? "Hard reset moves the current branch and discards working tree and staged changes. This cannot be undone from Pico."
          : resetMode === "soft"
            ? "Soft reset moves the current branch and keeps changes staged."
            : "Mixed reset moves the current branch and keeps changes in the working tree.",
      confirmLabel: `Reset ${resetMode}`,
      destructive: resetMode === "hard",
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
      className={cn(
        "h-8 min-h-8 w-full items-center gap-2 rounded-none px-1.5 py-0 font-mono text-[13px] leading-5 font-normal transition-[background-color,box-shadow,color] hover:no-underline focus-visible:ring-0 aria-expanded:bg-muted/50 **:data-[slot=accordion-trigger-icon]:size-4"
      )}
    >
      <span
        className="min-w-0 flex-1 truncate pr-8 text-foreground"
        style={{ paddingLeft: graphWidth }}
      >
        {title || parsed.hash || "Commit"}
      </span>
    </AccordionTrigger>
  )

  const commitActionProps = {
    disabled: !canRunCommitAction,
    onViewDiff: () => openDiff("commit"),
    onCompareHead: () => openDiff("head"),
    onComparePrevious: () => openDiff("previous"),
    onCopyHash: () => {
      void copyGitCommitValue(parsed.fullHash)
    },
    onCopyMessage: () => {
      void copyGitCommitValue(title)
    },
    onCreateBranch: () => {
      setFormDialog({
        kind: "branch",
        title: "Create branch from commit",
        description: `Create and check out a new branch at ${shortHash}.`,
        value: defaultGitBranchName(title, shortHash),
      })
    },
    onCheckout: () => {
      if (!parsed.fullHash) return
      showConfirm({
        action: "checkout",
        commit: parsed.fullHash,
        label: "Checked out commit",
        title: `Checkout ${shortHash}?`,
        description:
          "This switches to a detached HEAD at the selected commit. Commit or stash local changes first.",
        confirmLabel: "Checkout",
      })
    },
    onCherryPick: () => {
      if (!parsed.fullHash) return
      showConfirm({
        action: "cherry-pick",
        commit: parsed.fullHash,
        label: "Cherry-picked commit",
        title: `Cherry-pick ${shortHash}?`,
        description:
          "This applies the selected commit on top of the current branch.",
        confirmLabel: "Cherry-pick",
      })
    },
    onRevert: () => {
      if (!parsed.fullHash) return
      showConfirm({
        action: "revert",
        commit: parsed.fullHash,
        label: "Reverted commit",
        title: `Revert ${shortHash}?`,
        description:
          "This creates a new commit that reverses the selected commit.",
        confirmLabel: "Revert",
      })
    },
    onTag: () => {
      setFormDialog({
        kind: "tag",
        title: "Tag commit",
        description: `Create a lightweight tag at ${shortHash}.`,
        value: defaultGitTagName(shortHash),
      })
    },
    onOpenRemote: openRemoteCommit,
    onReset: showResetConfirm,
    onRebase: () => {
      if (!parsed.fullHash) return
      showConfirm({
        action: "rebase",
        commit: parsed.fullHash,
        label: "Rebased branch",
        title: `Rebase onto ${shortHash}?`,
        description:
          "This rebases the current branch onto the selected commit. Conflicts may need to be resolved from the terminal.",
        confirmLabel: "Rebase",
        destructive: true,
      })
    },
    onDrop: () => {
      if (!parsed.fullHash) return
      showConfirm({
        action: "drop",
        commit: parsed.fullHash,
        label: "Dropped commit",
        title: `Drop ${shortHash}?`,
        description:
          "This rewrites the current branch by replaying commits after the selected commit onto its parent.",
        confirmLabel: "Drop commit",
        destructive: true,
      })
    },
    onSquash: () => {
      setFormDialog({
        kind: "squash",
        title: "Squash commits after this commit",
        description: `Soft reset to ${shortHash}, then create one replacement commit from all newer commits.`,
        value: title
          ? `Squash changes after ${title}`
          : `Squash after ${shortHash}`,
      })
    },
    canCopyMessage: Boolean(title),
    busy: gitCommitActionMutation.isPending || createBranchMutation.isPending,
  } satisfies GitCommitActionsProps

  const runContextAction = (action: () => void) => {
    contextMenuActionsRef.current?.close()
    contextMenuActionsRef.current?.unmount()
    flushSync(() => {
      setContextMenuOpen(false)
      setContextMenuKey((key) => key + 1)
    })
    action()
  }

  return (
    <AccordionItem value={value} className="border-0">
      <div className="group/commit-row relative min-w-0">
        <ContextMenu
          key={contextMenuKey}
          open={contextMenuOpen}
          onOpenChange={setContextMenuOpen}
          actionsRef={contextMenuActionsRef}
        >
          <ContextMenuTrigger render={trigger} />
          <GitCommitActionsContextMenuContent
            {...commitActionProps}
            runAction={runContextAction}
          />
        </ContextMenu>
      </div>
      <AccordionContent className="relative h-[300px] border-b border-border/70 bg-muted/50 p-0">
        <div
          ref={commitBodyScrollRef}
          className="h-full overflow-y-auto pr-2 pb-2"
          onScroll={(event) => {
            updateCommitBodyScrollShadows(event.currentTarget)
          }}
        >
          <div
            className="grid content-start gap-1.5 pt-1 font-mono text-xs leading-4"
            style={{ paddingLeft: graphWidth }}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-sans">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!canRunCommitAction}
                onClick={() => openDiff("commit")}
              >
                <FileDiffIcon />
                View diff
              </Button>
              <GitCommitActionsMenu {...commitActionProps} />
            </div>
            {parsed.author || time || parsed.fullHash ? (
              <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                {parsed.author ? <span>{parsed.author}</span> : null}
                {parsed.author && time ? <span aria-hidden>·</span> : null}
                {time ? (
                  <TitleTooltip title={fullTime} side="top">
                    <span>{time}</span>
                  </TitleTooltip>
                ) : null}
                {(parsed.author || time) && parsed.fullHash ? (
                  <span aria-hidden>·</span>
                ) : null}
                {parsed.fullHash ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{shortHash}</span>
                    <TitleTooltip
                      title={hashCopied ? "Copied" : "Copy full commit hash"}
                      side="top"
                    >
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
                    </TitleTooltip>
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="max-w-full break-words whitespace-normal text-foreground">
              {title || "No commit message"}
              {title ? (
                <TitleTooltip
                  title={messageCopied ? "Copied" : "Copy commit message"}
                  side="top"
                >
                  <button
                    type="button"
                    aria-label="Copy commit message"
                    className="ml-1 inline-flex size-4 items-center justify-center rounded-sm align-middle text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      copyCommitMessageInline()
                    }}
                  >
                    {messageCopied ? (
                      <CheckIcon className="size-3.5 text-emerald-500" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </button>
                </TitleTooltip>
              ) : null}
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
              <GitCommitFilesList
                viewerContextId={viewerContextId}
                cwd={cwd}
                commit={parsed.fullHash}
                shortHash={shortHash}
                previousShortHash={parsed.parents[0]?.slice(0, 7) || ""}
                subject={title}
                disabled={!canRunCommitAction}
                onOpenCommitDiff={onOpenCommitDiff}
              />
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-b from-black/10 to-transparent transition-opacity duration-150",
            commitBodyHeaderShadowed ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-t from-black/10 to-transparent transition-opacity duration-150",
            commitBodyFooterShadowed ? "opacity-100" : "opacity-0"
          )}
        />
      </AccordionContent>
      <Dialog
        open={formDialog !== null}
        focusPromptOnClose={false}
        onOpenChange={(open) => {
          if (!open) setFormDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={submitFormAction}>
            <DialogHeader>
              <DialogTitle>{formDialog?.title || "Commit action"}</DialogTitle>
              <DialogDescription>{formDialog?.description}</DialogDescription>
            </DialogHeader>
            {formDialog?.kind === "squash" ? (
              <Textarea
                value={formDialog.value}
                rows={4}
                onChange={(event) => {
                  setFormDialog((current) =>
                    current
                      ? { ...current, value: event.target.value }
                      : current
                  )
                }}
              />
            ) : (
              <Input
                value={formDialog?.value || ""}
                onChange={(event) => {
                  setFormDialog((current) =>
                    current
                      ? { ...current, value: event.target.value }
                      : current
                  )
                }}
              />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!formDialog?.value.trim()}>
                {formDialog?.kind === "branch"
                  ? "Create branch"
                  : formDialog?.kind === "tag"
                    ? "Create tag"
                    : "Squash"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmDialog !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangleIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {confirmDialog?.title || "Run commit action?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmDialog?.destructive ? "destructive" : "default"}
              onClick={runConfirmedAction}
            >
              {confirmDialog?.confirmLabel || "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccordionItem>
  )
}

function GitCommitRows({
  viewerContextId,
  cwd,
  lines,
  unpushedCommitHashes,
  onOpenCommitDiff,
}: {
  viewerContextId: string
  cwd: string
  lines: Array<string>
  unpushedCommitHashes: Set<string>
  onOpenCommitDiff?: (request: GitCommitDiffTabRequest) => void
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
        unpushedCommitHashes={unpushedCommitHashes}
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
            key={rowValues[index] ?? line}
            className="min-w-0"
            style={{
              minHeight: rowHeights[index] ?? GIT_GRAPH_ROW_HEIGHT,
            }}
          >
            <GitCommitRow
              viewerContextId={viewerContextId}
              cwd={cwd}
              graphWidth={graphWidth}
              line={line}
              value={rowValues[index] ?? `${index}`}
              onOpenCommitDiff={onOpenCommitDiff}
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
  onOpenCommitDiff,
  embedded = false,
  flush = false,
}: GitScopedProps & {
  onOpenCommitDiff?: (request: GitCommitDiffTabRequest) => void
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
  const unpushedCommitHashes = new Set(commitsData?.unpushedCommitHashes ?? [])
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
        viewerContextId={viewerContextId}
        cwd={normalizedCwd}
        lines={commits}
        unpushedCommitHashes={unpushedCommitHashes}
        onOpenCommitDiff={onOpenCommitDiff}
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
