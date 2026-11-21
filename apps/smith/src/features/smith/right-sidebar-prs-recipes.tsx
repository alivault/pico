/**
 * Recipes in the GitHub tab: prompt templates that hand a pull request to
 * an agent (server `pr-recipes.ts`). The bar of the detail, the row menu
 * and the keys run them; "Manage recipes…" edits the list of the project.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookTextIcon,
  CopyIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"

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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import { emitSmithEvent } from "@/features/smith/agent/events"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import { useMachineFeature } from "@/features/smith/machine-store"
import { useElementWidth } from "@/features/smith/right-sidebar-issues"
import type { ShownPr } from "@/features/smith/right-sidebar-prs-data"
import { GitSectionNote } from "@/features/smith/right-sidebar-section-note"
import { getErrorMessage } from "@/features/smith/right-sidebar-shared"
import type { BranchAgent } from "@/features/smith/sidebar-store-context"
import type {
  GhHandOffResponse,
  GhPrSummary,
  GhRecipe,
  GhRecipePreviewResponse,
  GhRecipesResponse,
  GhRecipesSaveResponse,
} from "@/lib/smith/api"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"
import { cn } from "@/lib/utils"

type Scope = { viewerContextId: string; cwd: string }
type RecipesData = Extract<GhRecipesResponse, { ok: true }>

const TOKEN = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g

export function usesQuestion(template: string) {
  return /\{\{\s*question\s*\}\}/.test(template)
}

export function unknownVariables(template: string, known: Array<string>) {
  const names = new Set(known)
  const unknown = new Set<string>()
  for (const match of template.matchAll(TOKEN))
    if (!names.has(match[1]!)) unknown.add(match[1]!)
  return [...unknown]
}

/** Whether a recipe shows for a pull request (its `when`). */
export function recipeApplies(
  recipe: GhRecipe,
  pr: GhPrSummary & Partial<Pick<ShownPr, "threads" | "checkRuns">>
) {
  if (recipe.when === "failed-checks") return pr.checks.failed > 0
  if (recipe.when === "threads")
    return pr.threads
      ? pr.threads.some((thread) => !thread.isResolved)
      : pr.commentCount > 0
  return true
}

export function recipeIcon(recipe: GhRecipe) {
  switch (recipe.builtin) {
    case "fix-ci":
      return <WrenchIcon />
    case "address":
      return <MessageSquareIcon />
    case "review":
      return <SearchCheckIcon />
    case "ask":
      return <MessageCircleQuestionIcon />
    default:
      return <SparklesIcon />
  }
}

function recipeLabel(recipe: GhRecipe, pr: ShownPr) {
  if (recipe.builtin === "address") {
    const open = pr.threads.filter((thread) => !thread.isResolved).length
    return open > 0 ? `${recipe.name} (${open})` : recipe.name
  }
  return recipe.name
}

export function useRecipes(scope: Scope, enabled: boolean) {
  const machineId = useMachineId()
  const available = useMachineFeature("github-pr-recipes")
  return useQuery({
    queryKey: ["smith", "gh-recipes", scope.viewerContextId, scope.cwd],
    queryFn: () =>
      fetchJson<RecipesData>(
        buildRequestUrl(
          `/api/gh-recipes?${new URLSearchParams({ cwd: scope.cwd }).toString()}`,
          { machineId, contextId: scope.viewerContextId }
        )
      ),
    enabled: Boolean(
      enabled && available && scope.viewerContextId && scope.cwd
    ),
    staleTime: 5 * 60_000,
  })
}

function usePost(scope: Scope) {
  const machineId = useMachineId()
  return React.useCallback(
    <T,>(path: string, body: Record<string, unknown>) =>
      fetchJson<T>(
        buildRequestUrl(path, {
          machineId,
          contextId: scope.viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: scope.cwd, ...body }),
        }
      ),
    [machineId, scope.viewerContextId, scope.cwd]
  )
}

// ---------------------------------------------------------------------------
// Run

type RunInput = {
  recipe: GhRecipe
  number: number
  title: string
  agentId?: string
}

export type RecipeRunner = {
  run: (input: RunInput) => void
  pendingId: string | undefined
}

/**
 * Run recipes: ask for a question or the agent first when the recipe
 * needs it. Render `element` once, for that dialog.
 */
export function useRecipeRunner(scope: Scope) {
  const post = usePost(scope)
  const [asking, setAsking] = React.useState<RunInput | null>(null)
  const [question, setQuestion] = React.useState("")
  const mutation = useMutation({
    mutationFn: (input: RunInput & { question?: string; target?: string }) =>
      post<Extract<GhHandOffResponse, { ok: true }>>("/api/gh-pr/recipe-run", {
        number: input.number,
        recipeId: input.recipe.id,
        ...(input.question ? { question: input.question } : {}),
        ...(input.target ? { target: input.target } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
      }),
    onSuccess: (data, input) => {
      toast.success(
        data.created
          ? `${input.recipe.name}: started an agent in a new worktree`
          : data.queued
            ? `${input.recipe.name}: queued for the agent`
            : `${input.recipe.name}: sent to the agent`
      )
      if (data.note) toast.warning(data.note)
      emitSmithEvent("smith:open-agent", { agentId: data.agentId })
    },
    onError: (error, input) =>
      toast.error(getErrorMessage(error, `Could not run ${input.recipe.name}`)),
  })
  const run = (input: RunInput) => {
    if (usesQuestion(input.recipe.template) || input.recipe.target === "ask") {
      setQuestion("")
      setAsking(input)
      return
    }
    mutation.mutate(input)
  }
  const needsQuestion = asking ? usesQuestion(asking.recipe.template) : false
  const send = (target?: "branch" | "new") => {
    if (!asking || (needsQuestion && !question.trim())) return
    mutation.mutate({
      ...asking,
      ...(needsQuestion ? { question } : {}),
      ...(target ? { target } : {}),
    })
    setAsking(null)
  }
  const element = (
    <Dialog
      open={asking !== null}
      focusPromptOnClose={false}
      onOpenChange={(open) => !open && setAsking(null)}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (asking?.recipe.target !== "ask") send()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {asking?.recipe.name.replace(/…$/, "")} · #{asking?.number}
            </DialogTitle>
            <DialogDescription>{asking?.title}</DialogDescription>
          </DialogHeader>
          {needsQuestion ? (
            <Textarea
              autoFocus
              rows={5}
              placeholder="What do you want to know or change?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (asking?.recipe.target === "ask") send("branch")
                  else event.currentTarget.form?.requestSubmit()
                }
              }}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAsking(null)}
            >
              Cancel
            </Button>
            {asking?.recipe.target === "ask" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={needsQuestion && !question.trim()}
                  onClick={() => send("new")}
                >
                  New Agent
                </Button>
                <Button
                  type="button"
                  disabled={needsQuestion && !question.trim()}
                  onClick={() => send("branch")}
                >
                  Agent on Branch
                </Button>
              </>
            ) : (
              <Button
                type="submit"
                disabled={needsQuestion && !question.trim()}
              >
                Send
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
  return {
    runner: {
      run,
      pendingId: mutation.isPending ? mutation.variables?.recipe.id : undefined,
    } satisfies RecipeRunner,
    element,
  }
}

// ---------------------------------------------------------------------------
// The bar of the detail

/** The width of one recipe button, for the overflow. */
const BUTTON_WIDTH = 120

export function RecipeBar({
  pr,
  agent,
  recipes,
  runner,
  onManage,
  wake,
}: {
  pr: ShownPr
  agent?: BranchAgent
  recipes: Array<GhRecipe>
  runner: RecipeRunner
  onManage: () => void
  /** The wake menu of the agent, after the target note. */
  wake?: React.ReactNode
}) {
  const { ref, width } = useElementWidth()
  const shown = recipes.filter(
    (recipe) =>
      !recipe.hidden && recipe.showIn !== "row" && recipeApplies(recipe, pr)
  )
  // Leave room for the ⋯ button.
  const fit = Math.max(1, Math.floor((width - 36) / BUTTON_WIDTH))
  const buttons = shown.length <= fit ? shown : shown.slice(0, fit)
  const more = shown.slice(buttons.length)
  const target = (recipe: GhRecipe) =>
    recipe.target === "new"
      ? `Starts an agent in a new worktree on ${pr.headRefName}.`
      : recipe.target === "ask"
        ? "Asks which agent."
        : agent
          ? `Sends it to ${agent.title}, the agent on ${pr.headRefName}.`
          : `Starts an agent in a new worktree on ${pr.headRefName}.`
  const run = (recipe: GhRecipe) =>
    runner.run({
      recipe,
      number: pr.number,
      title: pr.title,
      ...(agent ? { agentId: agent.id } : {}),
    })
  if (pr.state !== "OPEN") return null
  return (
    <div className="grid gap-1">
      <div ref={ref} className="flex flex-wrap items-center gap-1">
        {buttons.map((recipe) => (
          <TitleTooltip
            key={recipe.id}
            title={`${recipe.key ? `${recipe.name} (${recipe.key}). ` : ""}${target(recipe)}`}
          >
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={Boolean(runner.pendingId)}
              onClick={() => run(recipe)}
            >
              {runner.pendingId === recipe.id ? (
                <Spinner size="xs" />
              ) : (
                recipeIcon(recipe)
              )}
              {recipeLabel(recipe, pr)}
            </Button>
          </TitleTooltip>
        ))}
        <DropdownMenu>
          <TitleTooltip title="More recipes">
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="More recipes"
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
          </TitleTooltip>
          <DropdownMenuContent align="start" className="w-56">
            {more.map((recipe) => (
              <DropdownMenuItem key={recipe.id} onClick={() => run(recipe)}>
                {recipeIcon(recipe)}
                {recipeLabel(recipe, pr)}
              </DropdownMenuItem>
            ))}
            {more.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onClick={onManage}>
              <BookTextIcon />
              Manage recipes…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        {agent ? `To ${agent.title}` : "To a new agent in a new worktree"}
        {wake}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor

const TARGETS = [
  { value: "branch", label: "Agent on the branch" },
  { value: "new", label: "New agent in a worktree" },
  { value: "ask", label: "Ask each time" },
]
const SHOW_IN = [
  { value: "both", label: "Detail bar and row menu" },
  { value: "detail", label: "Detail bar" },
  { value: "row", label: "Row menu" },
]
const WHEN = [
  { value: "always", label: "Always" },
  { value: "failed-checks", label: "When checks failed" },
  { value: "threads", label: "When threads are open" },
]
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"]
const DEFAULT = "__default__"

function newId(name: string, taken: Set<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "recipe"
  let id = base
  for (let index = 2; taken.has(id); index++) id = `${base}-${index}`
  return id
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

function Choice({
  value,
  items,
  onChange,
}: {
  value: string
  items: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange(String(next ?? ""))}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function keyProblem(
  recipe: GhRecipe,
  recipes: Array<GhRecipe>,
  reserved: Array<string>
) {
  const key = recipe.key
  if (!key) return ""
  if (!/^[A-Za-z0-9]$/.test(key)) return "One letter or digit."
  if (reserved.includes(key)) return `${key} is a key of the GitHub tab.`
  const other = recipes.find(
    (item) => item.id !== recipe.id && item.key === key
  )
  return other ? `${other.name} uses ${key}.` : ""
}

function Preview({
  scope,
  number,
  template,
  unknown,
}: {
  scope: Scope
  number: number | null
  template: string
  unknown: Array<string>
}) {
  const post = usePost(scope)
  const [load, setLoad] = React.useState(false)
  const [debounced, setDebounced] = React.useState(template)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(template), 400)
    return () => window.clearTimeout(timer)
  }, [template])
  const onDemand = /\{\{\s*(failedChecks|diff)\s*\}\}/.test(debounced)
  const preview = useQuery({
    queryKey: [
      "smith",
      "gh-recipe-preview",
      scope.viewerContextId,
      scope.cwd,
      number,
      debounced,
      load && onDemand,
    ],
    queryFn: () =>
      post<Extract<GhRecipePreviewResponse, { ok: true }>>(
        "/api/gh-recipes/preview",
        { number, template: debounced, load: load && onDemand }
      ),
    enabled:
      number !== null && unknown.length === 0 && Boolean(debounced.trim()),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: false,
  })
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {number !== null ? `Preview with #${number}` : "Preview"}
        </span>
        {preview.isFetching ? <Spinner size="xs" /> : null}
        <span className="flex-1" />
        {onDemand && number !== null ? (
          <Button
            type="button"
            size="xs"
            variant={load ? "secondary" : "outline"}
            onClick={() => setLoad((current) => !current)}
          >
            {load ? "Loaded" : "Load"} logs and diff
          </Button>
        ) : null}
      </div>
      {number === null ? (
        <GitSectionNote>Open a pull request to see a preview.</GitSectionNote>
      ) : unknown.length > 0 ? (
        <GitSectionNote tone="destructive">
          Unknown variable{unknown.length === 1 ? "" : "s"}:{" "}
          {unknown.map((name) => `{{${name}}}`).join(", ")}
        </GitSectionNote>
      ) : preview.error ? (
        <GitSectionNote tone="destructive">
          {getErrorMessage(preview.error, "Could not render the preview")}
        </GitSectionNote>
      ) : (
        <pre className="min-h-0 overflow-auto rounded-lg border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">
          {preview.data?.text ?? ""}
        </pre>
      )}
    </section>
  )
}

export function RecipesDialog({
  scope,
  open,
  onOpenChange,
  previewNumber,
}: {
  scope: Scope
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The open pull request, for the preview. */
  previewNumber: number | null
}) {
  const query = useRecipes(scope, open)
  const queryClient = useQueryClient()
  const post = usePost(scope)
  const [draft, setDraft] = React.useState<Array<GhRecipe> | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [error, setError] = React.useState("")
  const templateRef = React.useRef<HTMLTextAreaElement>(null)
  const data = query.data
  React.useEffect(() => {
    if (!open) {
      setDraft(null)
      setError("")
      return
    }
    if (data && draft === null) {
      setDraft(data.recipes)
      setSelectedId(data.recipes[0]?.id ?? null)
    }
  }, [open, data, draft])
  const list = draft ?? []
  const selected = list.find((recipe) => recipe.id === selectedId)
  const known = data?.variables.map((item) => item.name) ?? []
  const reserved = data?.reservedKeys ?? []
  const update = (change: Partial<GhRecipe>) =>
    setDraft((current) =>
      (current ?? []).map((recipe) =>
        recipe.id === selectedId ? { ...recipe, ...change } : recipe
      )
    )
  const move = (id: string, step: number) =>
    setDraft((current) => {
      const next = [...(current ?? [])]
      const from = next.findIndex((recipe) => recipe.id === id)
      const to = from + step
      if (from < 0 || to < 0 || to >= next.length) return current
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return next
    })
  const add = (from?: GhRecipe) => {
    const taken = new Set(list.map((recipe) => recipe.id))
    const names = new Set(list.map((recipe) => recipe.name.toLowerCase()))
    let name = from ? `${from.name.replace(/…$/, "")} copy` : "New recipe"
    for (let index = 2; names.has(name.toLowerCase()); index++)
      name = `${from ? `${from.name.replace(/…$/, "")} copy` : "New recipe"} ${index}`
    const recipe: GhRecipe = from
      ? {
          ...structuredClone(from),
          id: newId(name, taken),
          name,
          key: undefined,
          builtin: undefined,
          hidden: false,
        }
      : {
          id: newId(name, taken),
          name,
          template: "About GitHub pull request {{pr}}: {{title}}\n{{url}}\n\n",
          target: "branch",
          wake: { ci: false, comments: false, state: false },
          showIn: "both",
          when: "always",
          hidden: false,
        }
    setDraft([...list, recipe])
    setSelectedId(recipe.id)
  }
  const insert = (name: string) => {
    const area = templateRef.current
    if (!selected) return
    const text = `{{${name}}}`
    const start = area?.selectionStart ?? selected.template.length
    const end = area?.selectionEnd ?? start
    update({
      template:
        selected.template.slice(0, start) + text + selected.template.slice(end),
    })
    window.requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(start + text.length, start + text.length)
    })
  }
  const save = useMutation({
    mutationFn: () =>
      post<Extract<GhRecipesSaveResponse, { ok: true }>>("/api/gh-recipes", {
        // `undefined` keys drop out of the JSON.
        recipes: list,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<RecipesData>(
        ["smith", "gh-recipes", scope.viewerContextId, scope.cwd],
        (current) =>
          current ? { ...current, recipes: result.recipes } : current
      )
      toast.success("Saved the recipes")
      onOpenChange(false)
    },
    onError: (failure) => setError(getErrorMessage(failure, "Could not save")),
  })
  const reset = useMutation({
    mutationFn: () =>
      post<Extract<GhRecipesSaveResponse, { ok: true }>>(
        "/api/gh-recipes/reset",
        {}
      ),
    onSuccess: (result) => {
      setDraft(result.recipes)
      setSelectedId(result.recipes[0]?.id ?? null)
      void queryClient.invalidateQueries({
        queryKey: ["smith", "gh-recipes", scope.viewerContextId, scope.cwd],
      })
      toast.success("Restored the built-in recipes")
    },
    onError: (failure) => setError(getErrorMessage(failure, "Could not reset")),
  })
  const unknown = selected ? unknownVariables(selected.template, known) : []
  const problems = list.flatMap((recipe) => {
    const out: Array<string> = []
    if (!recipe.name.trim()) out.push("A recipe has no name.")
    const bad = unknownVariables(recipe.template, known)
    if (bad.length > 0)
      out.push(
        `${recipe.name}: unknown ${bad.map((name) => `{{${name}}}`).join(", ")}`
      )
    const key = keyProblem(recipe, list, reserved)
    if (key) out.push(`${recipe.name}: ${key}`)
    return out
  })
  const models = data?.models ?? []
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Recipes</DialogTitle>
          <DialogDescription>
            Prompts that hand a pull request to an agent. They are kept for this
            project on the machine, for all browsers.
          </DialogDescription>
        </DialogHeader>
        {query.isPending || !draft ? (
          <GitSectionNote>
            <Spinner /> Loading the recipes…
          </GitSectionNote>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)] md:overflow-hidden">
            <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
              <ul className="min-h-0 overflow-y-auto">
                {list.map((recipe, index) => (
                  <li key={recipe.id}>
                    <div
                      className={cn(
                        "group/recipe flex items-center gap-1 rounded-md px-1.5 py-1 text-sm",
                        recipe.id === selectedId
                          ? "bg-primary/10"
                          : "hover:bg-muted/70"
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate text-left outline-none",
                          recipe.hidden && "text-muted-foreground line-through"
                        )}
                        onClick={() => setSelectedId(recipe.id)}
                      >
                        {recipe.name}
                      </button>
                      {recipe.key ? (
                        <kbd className="rounded border px-1 font-mono text-[10px] text-muted-foreground">
                          {recipe.key}
                        </kbd>
                      ) : null}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${recipe.name} up`}
                        disabled={index === 0}
                        onClick={() => move(recipe.id, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${recipe.name} down`}
                        disabled={index === list.length - 1}
                        onClick={() => move(recipe.id, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => add()}
                >
                  <PlusIcon />
                  Add
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate()}
                >
                  <RotateCcwIcon />
                  Reset built-ins
                </Button>
              </div>
            </section>
            {selected ? (
              <section className="grid min-h-0 content-start gap-2 overflow-y-auto pr-1">
                <div className="flex items-center gap-1">
                  <Input
                    aria-label="Name"
                    value={selected.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                  <TitleTooltip title={selected.hidden ? "Show" : "Hide"}>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={selected.hidden ? "Show" : "Hide"}
                      onClick={() => update({ hidden: !selected.hidden })}
                    >
                      {selected.hidden ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  </TitleTooltip>
                  <TitleTooltip title="Duplicate">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Duplicate"
                      onClick={() => add(selected)}
                    >
                      <CopyIcon />
                    </Button>
                  </TitleTooltip>
                  <TitleTooltip
                    title={
                      selected.builtin
                        ? "A built-in recipe can be hidden, not deleted"
                        : "Delete"
                    }
                  >
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      disabled={Boolean(selected.builtin)}
                      onClick={() => {
                        setDraft(
                          list.filter((recipe) => recipe.id !== selected.id)
                        )
                        setSelectedId(list[0]?.id ?? null)
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </TitleTooltip>
                </div>
                <Field label="Template">
                  <Textarea
                    ref={templateRef}
                    aria-label="Template"
                    rows={10}
                    aria-invalid={unknown.length > 0 || undefined}
                    className="font-mono text-xs"
                    value={selected.template}
                    onChange={(event) =>
                      update({ template: event.target.value })
                    }
                  />
                </Field>
                <div className="flex flex-wrap gap-1">
                  {(data?.variables ?? []).map((variable) => (
                    <TitleTooltip
                      key={variable.name}
                      title={variable.description}
                    >
                      <button
                        type="button"
                        className="rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => insert(variable.name)}
                      >
                        {variable.name}
                      </button>
                    </TitleTooltip>
                  ))}
                </div>
                {unknown.length > 0 ? (
                  <GitSectionNote tone="destructive">
                    Unknown variable{unknown.length === 1 ? "" : "s"}:{" "}
                    {unknown.map((name) => `{{${name}}}`).join(", ")}
                  </GitSectionNote>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Agent">
                    <Choice
                      value={selected.target}
                      items={TARGETS}
                      onChange={(value) =>
                        update({ target: value as GhRecipe["target"] })
                      }
                    />
                  </Field>
                  <Field label="Show in">
                    <Choice
                      value={selected.showIn}
                      items={SHOW_IN}
                      onChange={(value) =>
                        update({ showIn: value as GhRecipe["showIn"] })
                      }
                    />
                  </Field>
                  <Field label="Show">
                    <Choice
                      value={selected.when}
                      items={WHEN}
                      onChange={(value) =>
                        update({ when: value as GhRecipe["when"] })
                      }
                    />
                  </Field>
                  <Field
                    label="Key"
                    hint={
                      keyProblem(selected, list, reserved) ||
                      "Optional, in the GitHub tab."
                    }
                  >
                    <Input
                      aria-label="Key"
                      maxLength={1}
                      aria-invalid={
                        Boolean(keyProblem(selected, list, reserved)) ||
                        undefined
                      }
                      className="w-16 font-mono"
                      value={selected.key ?? ""}
                      onChange={(event) =>
                        update({ key: event.target.value || undefined })
                      }
                    />
                  </Field>
                  <Field label="Model of a new agent">
                    <Choice
                      value={
                        selected.model
                          ? `${selected.model.provider}/${selected.model.modelId}`
                          : DEFAULT
                      }
                      items={[
                        { value: DEFAULT, label: "Default" },
                        ...models.map((model) => ({
                          value: `${model.provider ?? ""}/${model.id}`,
                          label: model.name ?? model.id,
                        })),
                      ]}
                      onChange={(value) => {
                        if (value === DEFAULT)
                          return update({ model: undefined })
                        const slash = value.indexOf("/")
                        update({
                          model: {
                            provider: value.slice(0, slash),
                            modelId: value.slice(slash + 1),
                          },
                        })
                      }}
                    />
                  </Field>
                  <Field label="Thinking">
                    <Choice
                      value={selected.thinking ?? DEFAULT}
                      items={[
                        { value: DEFAULT, label: "Default" },
                        ...THINKING.map((level) => ({
                          value: level,
                          label: level,
                        })),
                      ]}
                      onChange={(value) =>
                        update({
                          thinking: value === DEFAULT ? undefined : value,
                        })
                      }
                    />
                  </Field>
                </div>
                <fieldset className="grid gap-1">
                  <legend className="text-xs font-medium text-muted-foreground">
                    Wake a new agent when
                  </legend>
                  {(
                    [
                      ["ci", "CI fails"],
                      ["comments", "A new review comment arrives"],
                      ["state", "The PR is merged or closed"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selected.wake[key]}
                        onCheckedChange={(checked) =>
                          update({
                            wake: { ...selected.wake, [key]: checked === true },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              </section>
            ) : (
              <GitSectionNote>Choose a recipe.</GitSectionNote>
            )}
            <Preview
              scope={scope}
              number={previewNumber}
              template={selected?.template ?? ""}
              unknown={unknown}
            />
          </div>
        )}
        {error || problems.length > 0 ? (
          <GitSectionNote tone="destructive">
            {error || problems[0]}
          </GitSectionNote>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!draft || problems.length > 0 || save.isPending}
            onClick={() => {
              setError("")
              save.mutate()
            }}
          >
            {save.isPending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
