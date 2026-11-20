import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { FolderIcon } from "lucide-react"

import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { viewerContextIdForSummaries } from "@/features/smith/machine-store"
import { useMachineId } from "@/lib/smith/machine-context"
import { cn } from "@/lib/utils"

type ProjectFaviconResponse = {
  ok: true
  cwd: string
  favicon: { path: string; version: string } | null
}

// A favicon changes seldom. The server keeps its answer for a minute too.
const FAVICON_STALE_MS = 5 * 60_000

/**
 * The icon of a project in the sidebar: its favicon when the project has
 * one (see `projectFavicon` on the server), or a folder.
 */
export function ProjectIcon({
  project,
  className,
}: {
  project: string
  className?: string
}) {
  const machineId = useMachineId()
  const contextId = viewerContextIdForSummaries()
  const [failedSrc, setFailedSrc] = React.useState("")
  const { data } = useQuery({
    queryKey: ["smith", "project-favicon", machineId, project] as const,
    queryFn: () =>
      fetchJson<ProjectFaviconResponse>(
        buildRequestUrl("/api/files/favicon", {
          machineId,
          contextId,
          searchParams: { cwd: project },
        })
      ),
    enabled: Boolean(project),
    staleTime: FAVICON_STALE_MS,
    retry: false,
  })
  const favicon = data?.favicon
  const src = favicon
    ? buildRequestUrl("/api/files/raw", {
        machineId,
        contextId,
        searchParams: {
          cwd: project,
          path: favicon.path,
          v: favicon.version,
        },
      })
    : ""

  if (!src || src === failedSrc)
    return (
      <FolderIcon
        className={cn("size-4 shrink-0 text-sidebar-foreground/50", className)}
      />
    )
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("size-4 shrink-0 rounded-[3px] object-contain", className)}
      onError={() => setFailedSrc(src)}
    />
  )
}
