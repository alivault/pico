/**
 * Search across agents in the agents dialog: the messages of all agents
 * that match the query, from the full-text index of each machine (see
 * `server/src/core/agent-search.ts`).
 */
import * as React from "react"
import { useQueries } from "@tanstack/react-query"
import { MessageSquareTextIcon } from "lucide-react"

import { CommandGroup, CommandItem } from "@/components/ui/command"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import type { MachineInfo } from "@/features/pico/machine-store"
import type { AgentSearchMatch, AgentSearchResponse } from "@/lib/pico/api"

/** A search waits for this pause in the typing. */
const SEARCH_DELAY_MS = 250
/** Shorter queries match too much to help. */
const MIN_QUERY_LENGTH = 3
/** The most agents of one machine. */
const MAX_AGENTS = 8

export type MessageSearchItem = {
  key: string
  machineId: string
  match: AgentSearchMatch
}

function useDelayedValue<T>(value: T, delayMs: number) {
  const [delayed, setDelayed] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDelayed(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return delayed
}

/**
 * The message matches of each machine in `machineIds`, in that order.
 * Without enough text, or while the dialog is closed, there are none.
 */
export function useAgentMessageSearch({
  open,
  query,
  machineIds,
  project,
  viewerContextId,
}: {
  open: boolean
  query: string
  machineIds: Array<string>
  /** Only agents of this project, on the machine of the page. */
  project?: { machineId: string; path: string }
  viewerContextId: string
}) {
  const typed = query.trim()
  const delayed = useDelayedValue(typed, SEARCH_DELAY_MS)
  const enabled = open && delayed.length >= MIN_QUERY_LENGTH
  const results = useQueries({
    queries: machineIds.map((machineId) => {
      const projectPath =
        project?.machineId === machineId ? project.path : undefined
      return {
        queryKey: [
          "pico",
          "agent-message-search",
          machineId,
          delayed,
          projectPath ?? "",
        ] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJson<AgentSearchResponse>(
            buildRequestUrl("/api/machine/agent/search", {
              machineId,
              contextId: viewerContextId,
              searchParams: {
                q: delayed,
                limit: String(MAX_AGENTS),
                prefix: "1",
                ...(projectPath ? { project: projectPath } : {}),
              },
            }),
            { signal }
          ),
        enabled,
        staleTime: 10_000,
        // An older machine has no search; that is not worth a retry.
        retry: false,
      }
    }),
  })
  const items: Array<MessageSearchItem> = enabled
    ? machineIds.flatMap((machineId, index) =>
        (results[index]?.data?.agents ?? []).map((match) => ({
          key: `message:${machineId}:${match.agentId}`,
          machineId,
          match,
        }))
      )
    : []
  const loading =
    open &&
    typed.length >= MIN_QUERY_LENGTH &&
    (typed !== delayed || results.some((result) => result.isFetching))
  const indexing = results.some((result) => result.data?.indexing)
  return { items, loading, indexing, active: typed.length >= MIN_QUERY_LENGTH }
}

/** A snippet with its matches in bold. */
function Snippet({ text }: { text: string }) {
  const parts = text.replace(/\s+/g, " ").split(/(\uE000[^\uE001]*\uE001)/)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("\uE000") ? (
          <mark
            key={index}
            className="bg-transparent font-semibold text-foreground"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

function tildePath(value: string) {
  return value
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

/** The "Messages" group of the agents dialog. */
export function AgentMessageSearchGroup({
  items,
  loading,
  indexing,
  machines,
  showMachine,
  onSelect,
}: {
  items: Array<MessageSearchItem>
  loading: boolean
  indexing: boolean
  machines: Array<MachineInfo>
  showMachine: boolean
  onSelect: (item: MessageSearchItem) => void
}) {
  if (items.length === 0 && !loading) return null
  const label = (machineId: string) =>
    machines.find((machine) => machine.id === machineId)?.label ?? machineId
  return (
    <CommandGroup
      heading={`Messages${loading ? " · searching" : ""}${indexing ? " · index is still being built" : ""}`}
    >
      {items.length === 0 ? (
        <CommandItem value="loading:messages" disabled>
          <Spinner className="text-primary" />
          <span className="text-muted-foreground">Searching messages…</span>
        </CommandItem>
      ) : null}
      {items.map((item) => {
        const { match } = item
        const hit = match.hits[0]
        return (
          <CommandItem
            key={item.key}
            value={item.key}
            onSelect={() => onSelect(item)}
            className="items-start py-2"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              <MessageSquareTextIcon className="size-3.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{match.title}</span>
                {match.archived ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    Archived
                  </span>
                ) : null}
              </span>
              {hit ? (
                <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                  <Snippet text={hit.snippet} />
                </span>
              ) : null}
              <span className="line-clamp-1 text-[11px] text-muted-foreground/70">
                {showMachine ? `${label(item.machineId)} · ` : ""}
                {tildePath(match.cwd)}
              </span>
            </div>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
