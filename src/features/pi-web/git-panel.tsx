import { GitBranchIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  type GitChangesResponse,
  type GitStatusResponse,
  isApiErrorResponse,
} from "@/lib/pi-web-api"

type GitPanelProps = {
  gitLoading: boolean
  gitStatus: GitStatusResponse | null
  gitChanges: GitChangesResponse | null
  cwd?: string
  onRefresh: () => void
}

export function GitPanel({
  gitLoading,
  gitStatus,
  gitChanges,
  cwd,
  onRefresh,
}: GitPanelProps) {
  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCwIcon /> Refresh
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Repository status</CardTitle>
            <CardDescription>{cwd || "No cwd"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {gitLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner /> Loading git details…
              </div>
            ) : isApiErrorResponse(gitStatus) ? (
              <div className="text-destructive">{gitStatus.error}</div>
            ) : gitStatus?.gitStatus ? (
              <>
                <div className="flex items-center gap-2">
                  <GitBranchIcon className="size-4" />
                  <span>{gitStatus.gitStatus.label}</span>
                </div>
                <div className="text-muted-foreground">
                  {gitStatus.gitStatus.title}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">
                No git repository detected.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Changes</CardTitle>
            <CardDescription>
              Native git inspection powered by the new backend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {gitLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner /> Loading changes…
              </div>
            ) : isApiErrorResponse(gitChanges) ? (
              <div className="text-destructive">{gitChanges.error}</div>
            ) : gitChanges?.files && gitChanges.files.length > 0 ? (
              <div className="space-y-2">
                {gitChanges.files.map((file) => (
                  <div
                    key={`${file.status}:${file.path}`}
                    className="rounded-lg border px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate font-medium">
                        {file.path}
                      </div>
                      <Badge variant="outline">{file.status}</Badge>
                    </div>
                    {(file.linesAdded != null || file.linesDeleted != null) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        +{file.linesAdded ?? 0} / -{file.linesDeleted ?? 0}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground">
                Working tree is clean.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
