/**
 * Quick actions on a pull request in the GitHub tab: the ⋯ menu of the
 * detail and the context menu of a row share their items. Also the
 * dialogs they open: assignees, reviewers, labels, close, and check out.
 * The keyboard shortcuts of the tab call the same actions.
 */
import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleDotIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LinkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TagIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { emitSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { copyRightSidebarTextToClipboard } from "@/features/smith/right-sidebar-git-data"
import {
  LabelChip,
  type MenuParts,
} from "@/features/smith/right-sidebar-issues"
import {
  useGitHubLabels,
  type AvailableRepo,
} from "@/features/smith/right-sidebar-issues-data"
import { usePrPost } from "@/features/smith/right-sidebar-prs-actions"
import { usePr, type ShownPr } from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import type {
  GhCheckoutInfoResponse,
  GhCheckoutResponse,
  GhMergeInfoResponse,
  GhPrPeopleResponse,
  GhPrSummary,
  GhRerunResponse,
  GhWriteResponse,
} from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

type Scope = { viewerContextId: string; cwd: string }

/** A pull request from the list, or the full one with its people. */
export type QuickPr = GhPrSummary &
  Partial<Pick<ShownPr, "assignees" | "reviewRequests">>

export type QuickDialogKind =
  | "assignees"
  | "reviewers"
  | "labels"
  | "close"
  | "checkout"

export type QuickDialog = { kind: QuickDialogKind; number: number } | null

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function useGetJson<T>(
  viewerContextId: string,
  path: string,
  params: Record<string, string>,
  enabled: boolean,
  staleTime = 0
) {
  const machineId = useMachineId()
  const search = new URLSearchParams(params).toString()
  return useQuery({
    queryKey: ["smith", "gh-prs-quick", viewerContextId, path, search],
    queryFn: () =>
      fetchJson<T>(
        buildRequestUrl(`${path}?${search}`, {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled,
    staleTime,
    retry: false,
  })
}

/** Whether the repository allows rebase, for "Update with rebase". */
export function useRebaseAllowed(
  scope: Scope,
  number: number,
  enabled: boolean
) {
  const info = useGetJson<Extract<GhMergeInfoResponse, { ok: true }>>(
    scope.viewerContextId,
    "/api/gh-pr/merge-info",
    { cwd: scope.cwd, number: String(number) },
    enabled,
    5 * 60_000
  )
  return info.data?.info.allowed.includes("rebase") ?? false
}

// ---------------------------------------------------------------------------
// The actions

export type PrQuickActions = ReturnType<typeof usePrQuickActions>

export function usePrQuickActions({
  viewerContextId,
  cwd,
  repo,
  openDialog,
}: Scope & {
  repo: AvailableRepo
  openDialog: (dialog: QuickDialog) => void
}) {
  const { post, refresh } = usePrPost(viewerContextId, cwd)
  const job = useMutation({
    mutationFn: async (input: {
      key: string
      run: () => Promise<string | undefined>
    }) => await input.run(),
    onSuccess: (message) => {
      if (message) toast.success(message)
      void refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error, "GitHub failed")),
  })
  const go = (key: string, run: () => Promise<string | undefined>) =>
    job.mutate({ key, run })
  const write = (path: string, body: Record<string, unknown>) =>
    post<Extract<GhWriteResponse, { ok: true }>>(path, body)
  const copy = async (text: string, what: string) => {
    try {
      await copyRightSidebarTextToClipboard(text)
      toast.success(`Copied the ${what}`)
    } catch (error) {
      toast.error(getErrorMessage(error, `Could not copy the ${what}`))
    }
  }
  const assigned = (pr: QuickPr) =>
    Boolean(repo.viewerLogin && pr.assignees?.includes(repo.viewerLogin))

  return {
    pendingKey: job.isPending ? job.variables?.key : undefined,
    openDialog,
    rerunFailed: (pr: QuickPr) =>
      go("rerun", async () => {
        const data = await post<Extract<GhRerunResponse, { ok: true }>>(
          "/api/gh-pr/rerun-failed",
          { number: pr.number }
        )
        for (const link of data.links)
          toast.info(`${link.name} is not a GitHub Actions check`, {
            description: "Run it again on its own site.",
            action: link.link
              ? {
                  label: "Open",
                  onClick: () =>
                    window.open(link.link, "_blank", "noopener,noreferrer"),
                }
              : undefined,
          })
        for (const error of data.errors) toast.warning(error)
        return data.rerun.length > 0
          ? `Running the failed jobs of ${plural(data.rerun.length, "workflow run")} again`
          : undefined
      }),
    updateBranch: (pr: QuickPr, rebase: boolean) =>
      go("update", async () => {
        await write("/api/gh-pr/update-branch", { number: pr.number, rebase })
        return `Updated the branch of #${pr.number}${rebase ? " with rebase" : ""}`
      }),
    toggleDraft: (pr: QuickPr) =>
      go("draft", async () => {
        await write("/api/gh-pr/draft", {
          number: pr.number,
          draft: !pr.isDraft,
        })
        return pr.isDraft
          ? `#${pr.number} is ready for review`
          : `#${pr.number} is a draft now`
      }),
    assigned,
    toggleAssignMe: (pr: QuickPr) =>
      go("assign", async () => {
        const remove = assigned(pr)
        await write("/api/gh-pr/edit", {
          number: pr.number,
          ...(remove
            ? { removeAssignees: [repo.viewerLogin] }
            : { addAssignees: ["@me"] }),
        })
        return remove
          ? `Unassigned you from #${pr.number}`
          : `Assigned you to #${pr.number}`
      }),
    edit: (
      number: number,
      change: Record<string, Array<string>>,
      message: string
    ) =>
      go("edit", async () => {
        await write("/api/gh-pr/edit", { number, ...change })
        return message
      }),
    setOpen: (pr: QuickPr, open: boolean) =>
      go("state", async () => {
        await write("/api/gh-pr/state", { number: pr.number, open })
        return open ? `Reopened #${pr.number}` : `Closed #${pr.number}`
      }),
    /** Close asks first; reopen does not. */
    toggleOpen: (pr: QuickPr) => {
      if (pr.state === "OPEN") openDialog({ kind: "close", number: pr.number })
      else if (pr.state === "CLOSED")
        go("state", async () => {
          await write("/api/gh-pr/state", { number: pr.number, open: true })
          return `Reopened #${pr.number}`
        })
    },
    copyBranch: (pr: QuickPr) => void copy(pr.headRefName, "branch name"),
    copyUrl: (pr: QuickPr) => void copy(pr.url, "link"),
  }
}

// ---------------------------------------------------------------------------
// Menu items

export function PrMenuItems({
  parts,
  pr,
  repo,
  actions,
  rebaseAllowed,
  onOpen,
}: {
  parts: MenuParts
  pr: QuickPr
  repo: AvailableRepo
  actions: PrQuickActions
  rebaseAllowed: boolean
  /** Show "Open" (in the list). */
  onOpen?: () => void
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = parts
  const open = pr.state === "OPEN"
  const canWrite = repo.viewerCanWrite
  const dialog = (kind: QuickDialogKind) =>
    actions.openDialog({ kind, number: pr.number })
  return (
    <>
      {onOpen ? (
        <Item onClick={onOpen}>
          <EyeIcon />
          Open
        </Item>
      ) : null}
      {open && canWrite ? (
        <>
          {pr.checks.failed > 0 ? (
            <Item onClick={() => actions.rerunFailed(pr)}>
              <RotateCcwIcon />
              Rerun failed checks
            </Item>
          ) : null}
          {rebaseAllowed ? (
            <Sub>
              <SubTrigger>
                <RefreshCwIcon />
                Update branch
              </SubTrigger>
              <SubContent className="min-w-44">
                <Item onClick={() => actions.updateBranch(pr, false)}>
                  Update with merge commit
                </Item>
                <Item onClick={() => actions.updateBranch(pr, true)}>
                  Update with rebase
                </Item>
              </SubContent>
            </Sub>
          ) : (
            <Item onClick={() => actions.updateBranch(pr, false)}>
              <RefreshCwIcon />
              Update branch
            </Item>
          )}
          <Item onClick={() => actions.toggleDraft(pr)}>
            {pr.isDraft ? <GitPullRequestIcon /> : <GitPullRequestDraftIcon />}
            {pr.isDraft ? "Ready for review" : "Convert to draft"}
          </Item>
          <Separator />
        </>
      ) : null}
      {canWrite && pr.state !== "MERGED" ? (
        <>
          <Item onClick={() => actions.toggleAssignMe(pr)}>
            {actions.assigned(pr) ? <UserMinusIcon /> : <UserCheckIcon />}
            {actions.assigned(pr) ? "Unassign me" : "Assign me"}
          </Item>
          <Item onClick={() => dialog("assignees")}>
            <UserPlusIcon />
            Assignees…
          </Item>
          {open ? (
            <Item onClick={() => dialog("reviewers")}>
              <UsersIcon />
              Request reviewers…
            </Item>
          ) : null}
          <Item onClick={() => dialog("labels")}>
            <TagIcon />
            Labels…
          </Item>
          {open ? (
            <Item onClick={() => actions.toggleOpen(pr)}>
              <GitPullRequestClosedIcon className="text-red-500" />
              Close…
            </Item>
          ) : (
            <Item onClick={() => actions.toggleOpen(pr)}>
              <CircleDotIcon className="text-emerald-500" />
              Reopen
            </Item>
          )}
          <Separator />
        </>
      ) : null}
      {pr.state !== "MERGED" ? (
        <Item onClick={() => dialog("checkout")}>
          <GitBranchIcon />
          Check out locally…
        </Item>
      ) : null}
      <Item onClick={() => actions.copyBranch(pr)}>
        <CopyIcon />
        Copy branch name
      </Item>
      <Item onClick={() => actions.copyUrl(pr)}>
        <LinkIcon />
        Copy link
      </Item>
      <Item render={<a href={pr.url} target="_blank" rel="noreferrer" />}>
        <ExternalLinkIcon />
        Open on GitHub
      </Item>
    </>
  )
}

/** The items of a row menu: they load the full pull request for its people. */
export function PrRowMenuItems({
  scope,
  number,
  summary,
  ...rest
}: Omit<React.ComponentProps<typeof PrMenuItems>, "pr" | "rebaseAllowed"> & {
  scope: Scope
  number: number
  summary: GhPrSummary
}) {
  const full = usePr({ ...scope, number, enabled: true }).data
  const rebaseAllowed = useRebaseAllowed(
    scope,
    number,
    summary.state === "OPEN" && rest.repo.viewerCanWrite
  )
  const pr: QuickPr = full && !full.partial ? full : summary
  return <PrMenuItems {...rest} pr={pr} rebaseAllowed={rebaseAllowed} />
}

// ---------------------------------------------------------------------------
// Dialogs

function PeopleDialog({
  scope,
  pr,
  kind,
  actions,
  onClose,
}: {
  scope: Scope
  pr: ShownPr
  kind: "assignees" | "reviewers"
  actions: PrQuickActions
  onClose: () => void
}) {
  const [search, setSearch] = React.useState("")
  const peopleQuery = useGetJson<Extract<GhPrPeopleResponse, { ok: true }>>(
    scope.viewerContextId,
    "/api/gh-pr/people",
    { cwd: scope.cwd, number: String(pr.number) },
    true,
    60_000
  )
  const people = peopleQuery.data?.people
  const current =
    (kind === "assignees" ? pr.assignees : pr.reviewRequests) ?? []
  const suggested =
    kind === "reviewers"
      ? (people?.suggested ?? []).filter((person) => person.login !== pr.author)
      : []
  const others = (people?.assignable ?? []).filter(
    (person) =>
      !suggested.some((item) => item.login === person.login) &&
      (kind === "assignees" || person.login !== pr.author)
  )
  const known = new Set([
    ...current,
    ...suggested.map((person) => person.login),
    ...others.map((person) => person.login),
  ])
  const typed = search.trim().replace(/^@/, "")
  const word = kind === "assignees" ? "assignee" : "reviewer"
  const toggle = (login: string) => {
    const remove = current.includes(login)
    const key =
      kind === "assignees"
        ? remove
          ? "removeAssignees"
          : "addAssignees"
        : remove
          ? "removeReviewers"
          : "addReviewers"
    actions.edit(
      pr.number,
      { [key]: [login] },
      remove
        ? `Removed ${login} as ${word} of #${pr.number}`
        : kind === "assignees"
          ? `Assigned ${login} to #${pr.number}`
          : `Asked ${login} for a review of #${pr.number}`
    )
  }
  const row = (login: string, name: string) => (
    <CommandItem
      key={login}
      value={login}
      keywords={[name]}
      disabled={Boolean(actions.pendingKey)}
      onSelect={() => toggle(login)}
    >
      <CheckIcon
        className={cn("size-4", !current.includes(login) && "invisible")}
      />
      <span className="font-medium">{login}</span>
      {name ? <span className="text-muted-foreground">{name}</span> : null}
    </CommandItem>
  )
  return (
    <CommandDialog
      open
      title={kind === "assignees" ? "Assignees" : "Request Reviewers"}
      description={`Choose the ${word}s of #${pr.number}.`}
      onOpenChange={(open) => !open && onClose()}
    >
      <Command loop>
        <CommandInput
          placeholder={
            kind === "assignees" ? "Assign someone…" : "Ask someone to review…"
          }
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>
            {peopleQuery.isPending ? "Loading…" : "Nobody found."}
          </CommandEmpty>
          {peopleQuery.error ? (
            <GitSectionNote tone="destructive" className="px-3 py-2">
              {getErrorMessage(peopleQuery.error, "Could not load people")}
            </GitSectionNote>
          ) : null}
          {current.length > 0 ? (
            <CommandGroup heading="Now">
              {current.map((login) => row(login, ""))}
            </CommandGroup>
          ) : null}
          {suggested.length > 0 ? (
            <CommandGroup heading="Suggested">
              {suggested
                .filter((person) => !current.includes(person.login))
                .map((person) => row(person.login, person.name))}
            </CommandGroup>
          ) : null}
          {others.some((person) => !current.includes(person.login)) ? (
            <CommandGroup heading="People">
              {others
                .filter((person) => !current.includes(person.login))
                .map((person) => row(person.login, person.name))}
            </CommandGroup>
          ) : null}
          <CommandGroup>
            {typed && LOGIN.test(typed) && !known.has(typed) ? (
              <CommandItem
                value={`add:${typed}`}
                keywords={[typed]}
                onSelect={() => toggle(typed)}
              >
                <UserPlusIcon className="size-4" />
                Add {typed}
              </CommandItem>
            ) : null}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function LabelsDialog({
  scope,
  pr,
  actions,
  onClose,
}: {
  scope: Scope
  pr: ShownPr
  actions: PrQuickActions
  onClose: () => void
}) {
  const labelsQuery = useGitHubLabels(scope.viewerContextId, scope.cwd, true)
  const selected = new Set(pr.labels.map((label) => label.name))
  return (
    <CommandDialog
      open
      title="Labels"
      description={`Choose the labels of #${pr.number}.`}
      onOpenChange={(open) => !open && onClose()}
    >
      <Command loop>
        <CommandInput placeholder="Filter labels…" />
        <CommandList>
          <CommandEmpty>
            {labelsQuery.isPending ? "Loading…" : "No labels."}
          </CommandEmpty>
          <CommandGroup heading="Labels">
            {(labelsQuery.data ?? []).map((label) => {
              const on = selected.has(label.name)
              return (
                <CommandItem
                  key={label.name}
                  value={label.name}
                  keywords={[label.description ?? ""]}
                  disabled={Boolean(actions.pendingKey)}
                  onSelect={() =>
                    actions.edit(
                      pr.number,
                      on
                        ? { removeLabels: [label.name] }
                        : { addLabels: [label.name] },
                      on
                        ? `Removed ${label.name} from #${pr.number}`
                        : `Added ${label.name} to #${pr.number}`
                    )
                  }
                >
                  <CheckIcon className={cn("size-4", !on && "invisible")} />
                  <LabelChip label={label} />
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function CloseDialog({
  pr,
  actions,
  onClose,
}: {
  pr: ShownPr
  actions: PrQuickActions
  onClose: () => void
}) {
  return (
    <Dialog
      open
      focusPromptOnClose={false}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close #{pr.number}?</DialogTitle>
          <DialogDescription>
            {pr.title}. It is not merged. You can reopen it later; the branch
            stays.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            autoFocus
            onClick={() => {
              actions.setOpen(pr, false)
              onClose()
            }}
          >
            <GitPullRequestClosedIcon data-icon="inline-start" />
            Close Pull Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CheckoutDialog({
  scope,
  pr,
  onClose,
}: {
  scope: Scope
  pr: ShownPr
  onClose: () => void
}) {
  const { post } = usePrPost(scope.viewerContextId, scope.cwd)
  const infoQuery = useGetJson<Extract<GhCheckoutInfoResponse, { ok: true }>>(
    scope.viewerContextId,
    "/api/gh-pr/checkout-info",
    { cwd: scope.cwd, number: String(pr.number) },
    true
  )
  const info = infoQuery.data?.info
  const checkout = useMutation({
    mutationFn: (mode: "switch" | "worktree") =>
      post<Extract<GhCheckoutResponse, { ok: true }>>("/api/gh-pr/checkout", {
        number: pr.number,
        mode,
      }),
    onSuccess: (data) => {
      if (data.mode === "switch") {
        toast.success(`The project is on ${data.branch} now`)
      } else {
        toast.success(`Started an agent in a new worktree on ${data.branch}`)
        if (data.note) toast.warning(data.note)
        if (data.agentId)
          emitSmithEvent("smith:open-agent", { agentId: data.agentId })
      }
      onClose()
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Could not check out the branch")),
  })
  const onBranch = info && info.current === info.branch
  const blocked = info
    ? info.dirty
      ? `The project (${info.current || "detached"}) has uncommitted changes, so it cannot switch.`
      : info.worktree
        ? `${info.branch} is checked out in ${info.worktree}.`
        : ""
    : ""
  return (
    <Dialog
      open
      focusPromptOnClose={false}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check Out #{pr.number}</DialogTitle>
          <DialogDescription>
            {info
              ? onBranch
                ? `The project is on ${info.branch} already.`
                : `Switch the project from ${info.current || "a detached HEAD"} to ${info.branch}, or work on it in a new worktree with a new agent.`
              : "Looking at the project…"}
          </DialogDescription>
        </DialogHeader>
        {infoQuery.isPending ? (
          <GitSectionNote>
            <Spinner /> Looking at the project…
          </GitSectionNote>
        ) : infoQuery.error ? (
          <GitSectionNote tone="destructive">
            {getErrorMessage(infoQuery.error, "Could not read the project")}
          </GitSectionNote>
        ) : blocked ? (
          <GitSectionNote>{blocked}</GitSectionNote>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={info && (blocked || onBranch) ? "default" : "outline"}
            // A branch can be in one worktree only.
            disabled={!info || Boolean(info.worktree) || checkout.isPending}
            onClick={() => checkout.mutate("worktree")}
          >
            {checkout.isPending && checkout.variables === "worktree" ? (
              <Spinner />
            ) : null}
            New Worktree
          </Button>
          {!onBranch ? (
            <Button
              type="button"
              disabled={!info || Boolean(blocked) || checkout.isPending}
              onClick={() => checkout.mutate("switch")}
            >
              {checkout.isPending && checkout.variables === "switch" ? (
                <Spinner />
              ) : null}
              Switch Project
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The dialog that a menu item or a key opened. */
export function PrQuickDialogs({
  scope,
  dialog,
  actions,
  onClose,
}: {
  scope: Scope
  dialog: QuickDialog
  actions: PrQuickActions
  onClose: () => void
}) {
  const prQuery = usePr({
    ...scope,
    number: dialog?.number ?? 0,
    enabled: dialog !== null,
  })
  const pr = prQuery.data
  if (!dialog) return null
  // The dialogs need the people and labels of the full pull request; they
  // show when it loaded.
  if (!pr || pr.partial) return null
  switch (dialog.kind) {
    case "assignees":
    case "reviewers":
      return (
        <PeopleDialog
          scope={scope}
          pr={pr}
          kind={dialog.kind}
          actions={actions}
          onClose={onClose}
        />
      )
    case "labels":
      return (
        <LabelsDialog
          scope={scope}
          pr={pr}
          actions={actions}
          onClose={onClose}
        />
      )
    case "close":
      return <CloseDialog pr={pr} actions={actions} onClose={onClose} />
    case "checkout":
      return <CheckoutDialog scope={scope} pr={pr} onClose={onClose} />
  }
}
