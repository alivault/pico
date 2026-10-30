import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon, GitForkIcon } from "lucide-react"
import { toast } from "@/lib/pico/toast"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { TitleTooltip } from "@/components/ui/tooltip"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useMachineFeature } from "@/features/pico/machine-store"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type DraftWorktree = {
  ok: true
  enabled: boolean
  branch?: string
  gitRepository?: boolean
}

/**
 * The "New worktree" option of a new agent. The choice is part of the
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
  // Each machine's app shell has a composer, so the IDs must be unique.
  const worktreeFieldId = React.useId()
  const branchFieldId = React.useId()
  const queryClient = useQueryClient()
  const queryKey = ["pico", "draft-worktree", viewerContextId, cwd] as const
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
      <TitleTooltip
        title={
          enabled
            ? "The new agent gets its own git worktree"
            : "The new agent works in this directory"
        }
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label="Worktree for the new agent"
              className={cn(enabled && "text-foreground")}
            />
          }
        >
          <GitForkIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {enabled
              ? `New worktree${query.data.branch ? `: ${query.data.branch}` : ""}`
              : "No worktree"}
          </span>
          <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
        </PopoverTrigger>
      </TitleTooltip>
      <PopoverContent align="start" className="w-80">
        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={worktreeFieldId}>New worktree</FieldLabel>
              <FieldDescription>
                The agent works in its own git worktree and branch, so it does
                not change the files that other agents use.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={worktreeFieldId}
              checked={enabled}
              disabled={mutation.isPending}
              onCheckedChange={(checked) =>
                mutation.mutate(
                  checked
                    ? { enabled: true, ...(branch.trim() ? { branch } : {}) }
                    : { enabled: false }
                )
              }
            />
          </Field>
          {enabled ? (
            <Field>
              <FieldLabel htmlFor={branchFieldId}>Branch name</FieldLabel>
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
                  id={branchFieldId}
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="Made from the first prompt"
                  className="h-8"
                />
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  disabled={(query.data.branch ?? "") === branch.trim()}
                >
                  Save
                </Button>
              </form>
            </Field>
          ) : null}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}

/** Hidden when the server of the page does not have the feature. */
export function NewAgentWorktreeToggle(
  props: React.ComponentProps<typeof NewAgentWorktreeToggleView>
) {
  const available = useMachineFeature("worktrees")
  return available ? <NewAgentWorktreeToggleView {...props} /> : null
}
