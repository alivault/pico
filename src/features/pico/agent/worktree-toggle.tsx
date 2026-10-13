import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, GitForkIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { cn } from "@/lib/utils"

type DraftWorktree = {
  ok: true
  enabled: boolean
  branch?: string
  gitRepository?: boolean
}

/**
 * The "New worktree" option of a new session. The choice is part of the
 * server's draft, so the first prompt creates the worktree with the session.
 */
export function NewSessionWorktreeToggle({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ["pico", "draft-worktree", viewerContextId, cwd] as const
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<DraftWorktree>(
        buildRequestUrl("/api/session/draft-worktree", {
          contextId: viewerContextId,
          searchParams: { cwd },
        })
      ),
    enabled: Boolean(cwd && viewerContextId),
  })
  const [branch, setBranch] = React.useState("")
  React.useEffect(() => {
    setBranch(query.data?.branch ?? "")
  }, [query.data?.branch])
  const mutation = useMutation({
    mutationFn: (body: { enabled: boolean; branch?: string }) =>
      fetchJson<DraftWorktree>(
        buildRequestUrl("/api/session/draft-worktree", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, ...body }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, (current: DraftWorktree | undefined) =>
        current ? { ...current, ...data } : data
      )
    },
    onError: (error) => toast.error(errorText(error)),
  })
  if (!query.data?.gitRepository) return null
  const enabled = query.data.enabled
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label="Worktree for the new session"
            className={cn(enabled && "text-foreground")}
          />
        }
      >
        <GitForkIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {enabled
            ? `Worktree${query.data.branch ? `: ${query.data.branch}` : ""}`
            : "No worktree"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <button
          type="button"
          className="flex w-full items-start gap-2 text-left text-sm"
          onClick={() =>
            mutation.mutate(
              enabled
                ? { enabled: false }
                : { enabled: true, ...(branch.trim() ? { branch } : {}) }
            )
          }
        >
          <span
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
              enabled && "border-primary bg-primary text-primary-foreground"
            )}
          >
            {enabled ? <CheckIcon className="size-3" /> : null}
          </span>
          <span>
            <span className="font-medium">New worktree</span>
            <span className="block text-xs text-muted-foreground">
              The session works in its own git worktree and branch, so it does
              not change files that other sessions use.
            </span>
          </span>
        </button>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({
              enabled: true,
              ...(branch.trim() ? { branch: branch.trim() } : {}),
            })
          }}
        >
          <Input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="Branch name (optional)"
            className="h-8"
          />
          <Button size="sm" type="submit" variant="outline">
            Use
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
