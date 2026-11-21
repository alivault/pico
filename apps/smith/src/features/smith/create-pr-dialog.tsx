/**
 * Create a pull request from the Changes tab: a button when the branch is
 * pushed, has no open pull request, and is not the default branch; and a
 * dialog with the base branch, a title and description that the model
 * writes from the commits, and a Draft option.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, GitPullRequestIcon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useMachineFeature } from "@/features/smith/machine-store"
import { useGitHubRepo } from "@/features/smith/right-sidebar-issues-data"
import {
  openGitHubPullRequest,
  useBranchPrs,
} from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import { useIsMobile } from "@/hooks/use-mobile"
import type {
  GhCreatePrInfoResponse,
  GhPrCreateResponse,
  GhPrTextResponse,
} from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

type Scope = { viewerContextId: string; cwd: string }

function CreatePrDialog({
  viewerContextId,
  cwd,
  open,
  onOpenChange,
}: Scope & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const url = (path: string) =>
    buildRequestUrl(path, { machineId, contextId: viewerContextId })
  const [base, setBase] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [draft, setDraft] = React.useState(false)
  const infoQuery = useQuery({
    queryKey: ["smith", "gh-create-pr-info", viewerContextId, cwd],
    queryFn: async () =>
      (
        await fetchJson<Extract<GhCreatePrInfoResponse, { ok: true }>>(
          url(`/api/gh-pr/create-info?cwd=${encodeURIComponent(cwd)}`)
        )
      ).info,
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const info = infoQuery.data
  const chosenBase = base || info?.defaultBranch || ""
  const textMutation = useMutation({
    mutationFn: (forBase: string) =>
      fetchJson<Extract<GhPrTextResponse, { ok: true }>>(
        url("/api/gh-pr/text"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, base: forBase }),
        }
      ),
    onSuccess: (data) => {
      setTitle(data.title)
      setBody(data.body)
      if (data.source === "heuristic" && data.reason)
        toast.message(`Wrote the text from the commits: ${data.reason}`)
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not write the text")),
  })
  // Write the text when the dialog opens and the branch can have a PR.
  const requestText = React.useEffectEvent((forBase: string) => {
    textMutation.mutate(forBase)
  })
  React.useEffect(() => {
    if (open && info && !info.reason && info.defaultBranch)
      requestText(info.defaultBranch)
  }, [open, info])
  React.useEffect(() => {
    if (open) return
    setBase("")
    setTitle("")
    setBody("")
    setDraft(false)
  }, [open])

  const create = useMutation({
    mutationFn: () =>
      fetchJson<Extract<GhPrCreateResponse, { ok: true }>>(
        url("/api/gh-pr/create"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, base: chosenBase, title, body, draft }),
        }
      ),
    onSuccess: async (data) => {
      toast.success(`Created pull request #${data.number}`)
      onOpenChange(false)
      await queryClient.invalidateQueries({
        queryKey: ["smith", "gh-branch-prs", viewerContextId],
      })
      await queryClient.invalidateQueries({
        queryKey: ["smith", "gh-prs", viewerContextId],
      })
      if (data.number) openGitHubPullRequest(machineId, data.number)
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not create the pull request")),
  })

  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim() && !create.isPending) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Pull Request</DialogTitle>
            <DialogDescription>
              {info?.branch
                ? `From ${info.branch} into ${chosenBase || "…"}.`
                : "From the current branch."}
            </DialogDescription>
          </DialogHeader>
          {infoQuery.isPending ? (
            <GitSectionNote>
              <Spinner /> Looking at the branch…
            </GitSectionNote>
          ) : infoQuery.error || !info ? (
            <GitSectionNote tone="destructive">
              {getErrorMessage(infoQuery.error, "Could not read the branch")}
            </GitSectionNote>
          ) : info.reason ? (
            <GitSectionNote tone="destructive">{info.reason}</GitSectionNote>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Base</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-mono"
                      />
                    }
                  >
                    {chosenBase}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80">
                    {info.bases.map((name) => (
                      <DropdownMenuItem
                        key={name}
                        className="font-mono"
                        onClick={() => {
                          if (name === chosenBase) return
                          setBase(name)
                          textMutation.mutate(name)
                        }}
                      >
                        <CheckIcon
                          className={cn(
                            "size-3.5",
                            name !== chosenBase && "invisible"
                          )}
                        />
                        {name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <TitleTooltip title="Write the title and description again">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={textMutation.isPending}
                    onClick={() => textMutation.mutate(chosenBase)}
                  >
                    {textMutation.isPending ? <Spinner /> : <SparklesIcon />}
                    Generate
                  </Button>
                </TitleTooltip>
              </div>
              <Input
                aria-label="Title"
                placeholder={textMutation.isPending ? "Writing…" : "Title"}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Textarea
                aria-label="Description"
                placeholder={
                  textMutation.isPending ? "Writing…" : "Description (Markdown)"
                }
                rows={9}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <Field orientation="horizontal">
                <Checkbox
                  id="create-pr-draft"
                  checked={draft}
                  onCheckedChange={(checked) => setDraft(checked)}
                />
                <FieldLabel htmlFor="create-pr-draft">
                  Create as a draft
                </FieldLabel>
              </Field>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !info ||
                Boolean(info.reason) ||
                !title.trim() ||
                create.isPending ||
                textMutation.isPending
              }
            >
              {create.isPending ? <Spinner /> : <GitPullRequestIcon />}
              {draft ? "Create Draft" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Create PR button of the Changes tab. It shows when the branch is
 * pushed (nothing ahead), is not the default branch, and has no open pull
 * request.
 */
export function CreatePrButton({
  viewerContextId,
  cwd,
  active,
  branch,
  ahead,
  className,
}: Scope & {
  active: boolean
  branch: string | undefined
  ahead: number
  className?: string
}) {
  const isMobile = useIsMobile()
  const available = useMachineFeature("github-pr-writes")
  const [open, setOpen] = React.useState(false)
  const repo = useGitHubRepo({
    viewerContextId,
    cwd,
    enabled: Boolean(active && available && branch),
  })
  const defaultBranch =
    repo.data?.available === true ? (repo.data.defaultBranch ?? "") : ""
  const candidate = Boolean(
    available &&
    branch &&
    repo.data?.available === true &&
    branch !== defaultBranch &&
    ahead === 0
  )
  const prs = useBranchPrs({
    viewerContextId,
    cwd,
    branches: branch ? [branch] : [],
    enabled: active && candidate,
  })
  const pr = branch ? prs.data?.[branch] : undefined
  if (!candidate || prs.isPending || pr?.state === "OPEN") return null
  return (
    <>
      <TitleTooltip title={`Create a pull request for ${branch}`}>
        <Button
          type="button"
          variant="outline"
          size={isMobile ? "default" : "sm"}
          className={cn("shrink-0", className)}
          onClick={() => setOpen(true)}
        >
          <GitPullRequestIcon />
          <span className="@max-[20rem]/git-toolbar:sr-only">Create PR</span>
        </Button>
      </TitleTooltip>
      <CreatePrDialog
        viewerContextId={viewerContextId}
        cwd={cwd}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
