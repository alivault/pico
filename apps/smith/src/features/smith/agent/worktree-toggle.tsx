import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon } from "lucide-react"
import { toast } from "@/lib/smith/toast"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { TitleTooltip } from "@/components/ui/tooltip"
import { errorText } from "@/features/smith/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useMachineFeature } from "@/features/smith/machine-store"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/smith/machine-context"

type DraftWorktree = {
  ok: true
  enabled: boolean
  branch?: string
  gitRepository?: boolean
}

/**
 * The "Worktree" toggle of a new agent. The choice is part of the
 * server's draft, so the first prompt creates the worktree with the agent.
 */
function NewAgentWorktreeToggleView({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  const machineId = useMachineId()
  // Each machine's app shell has a composer, so the ID must be unique.
  const branchFieldId = React.useId()
  const queryClient = useQueryClient()
  const queryKey = ["smith", "draft-worktree", viewerContextId, cwd] as const
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<DraftWorktree>(
        buildRequestUrl("/api/agent/draft-worktree", {
          machineId,
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
        buildRequestUrl("/api/agent/draft-worktree", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, ...body }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKey,
        (current: DraftWorktree | undefined) =>
          current ? { ...current, ...data } : data
      )
    },
    onError: (error) => toast.error(errorText(error)),
  })
  if (!query.data?.gitRepository) return null
  const enabled = query.data.enabled
  const savedBranch = query.data.branch ?? ""
  const saveBranch = () =>
    mutation.mutate({
      enabled: true,
      ...(branch.trim() ? { branch: branch.trim() } : {}),
    })
  return (
    <div className="flex min-w-0 items-center gap-1">
      <TitleTooltip
        title={
          enabled
            ? "The new agent gets its own git worktree and branch"
            : "The new agent works in the project directory"
        }
      >
        <label
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground",
            enabled && "text-foreground"
          )}
        >
          <Switch
            size="sm"
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(checked) =>
              mutation.mutate(
                checked
                  ? {
                      enabled: true,
                      ...(branch.trim() ? { branch: branch.trim() } : {}),
                    }
                  : { enabled: false }
              )
            }
          />
          Worktree
        </label>
      </TitleTooltip>
      {enabled ? (
        // The branch name is optional: the first prompt names it.
        <Popover>
          <TitleTooltip title="Branch name">
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Branch name"
                  className="min-w-0"
                />
              }
            >
              <span className="truncate">{savedBranch || "Auto branch"}</span>
              <PencilIcon className="size-3.5 shrink-0" aria-hidden="true" />
            </PopoverTrigger>
          </TitleTooltip>
          <PopoverContent align="start" className="w-80">
            <Field>
              <FieldLabel htmlFor={branchFieldId}>Branch name</FieldLabel>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveBranch()
                }}
              >
                <Input
                  id={branchFieldId}
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="Made from the first prompt"
                  className="h-7"
                />
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  disabled={savedBranch === branch.trim()}
                >
                  Save
                </Button>
              </form>
            </Field>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

/** Hidden when the server of the page does not have the feature. */
export function NewAgentWorktreeToggle(
  props: React.ComponentProps<typeof NewAgentWorktreeToggleView>
) {
  const available = useMachineFeature("worktrees")
  return available ? <NewAgentWorktreeToggleView {...props} /> : null
}
