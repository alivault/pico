/**
 * The GitHub tab of the right sidebar: issues and pull requests, with a
 * switch at the top. The tab keeps the value "issues" (stored as the
 * active tab), so older stored values still work.
 */
import * as React from "react"
import { InboxIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMachineFeature } from "@/features/smith/machine-store"
import { EmptyState, IssuesPanel } from "@/features/smith/right-sidebar-issues"
import { useGitHubRepo } from "@/features/smith/right-sidebar-issues-data"
import { PrsPanel } from "@/features/smith/right-sidebar-prs"
import { useRequestedPr } from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import { useIsMobile } from "@/hooks/use-mobile"
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/lib/smith"

type Segment = "issues" | "prs"
const SEGMENT_STORAGE_KEY = "smith.github.segment"

function readSegment(): Segment {
  return safeLocalStorageGetItem(SEGMENT_STORAGE_KEY) === "prs"
    ? "prs"
    : "issues"
}

export function GitHubPanel({
  viewerContextId,
  cwd,
  active,
}: {
  viewerContextId: string
  cwd: string
  active: boolean
}) {
  const isMobile = useIsMobile()
  const prsAvailable = useMachineFeature("github-prs")
  const [stored, setStored] = React.useState<Segment>(readSegment)
  const requested = useRequestedPr()
  const segment: Segment = prsAvailable ? stored : "issues"
  const repoQuery = useGitHubRepo({
    viewerContextId,
    cwd,
    enabled: active && segment === "prs",
  })
  const repo = repoQuery.data?.available ? repoQuery.data : undefined

  const choose = (value: Segment) => {
    setStored(value)
    safeLocalStorageSetItem(SEGMENT_STORAGE_KEY, value)
  }

  React.useEffect(() => {
    if (!requested) return
    setStored("prs")
    safeLocalStorageSetItem(SEGMENT_STORAGE_KEY, "prs")
  }, [requested])

  let prs: React.ReactNode = null
  if (segment === "prs") {
    if (!cwd) {
      prs = (
        <GitSectionNote className="px-3 py-2.5">
          No directory selected.
        </GitSectionNote>
      )
    } else if (repoQuery.isPending) {
      prs = (
        <GitSectionNote className="px-3 py-2.5">
          <Spinner /> Looking for the GitHub repository…
        </GitSectionNote>
      )
    } else if (!repo) {
      prs = (
        <EmptyState
          icon={<InboxIcon />}
          title="GitHub Is Not Available"
          description={
            repoQuery.error
              ? getErrorMessage(repoQuery.error, "GitHub is not available")
              : repoQuery.data && !repoQuery.data.available
                ? repoQuery.data.reason
                : undefined
          }
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void repoQuery.refetch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Try Again
            </Button>
          }
        />
      )
    } else {
      prs = (
        <PrsPanel
          key={cwd}
          viewerContextId={viewerContextId}
          cwd={cwd}
          repo={repo}
          active={active}
          requested={requested}
        />
      )
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {prsAvailable ? (
        <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
          <ToggleGroup
            variant="outline"
            size={isMobile ? "default" : "sm"}
            className="w-full"
            value={[segment]}
            onValueChange={(values) => {
              const value = values[0]
              if (value === "issues" || value === "prs") choose(value)
            }}
          >
            <ToggleGroupItem value="issues" className="flex-1">
              Issues
            </ToggleGroupItem>
            <ToggleGroupItem value="prs" className="flex-1">
              Pull Requests
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {segment === "issues" ? (
          <IssuesPanel
            viewerContextId={viewerContextId}
            cwd={cwd}
            active={active}
          />
        ) : (
          prs
        )}
      </div>
    </div>
  )
}
