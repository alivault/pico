/**
 * The sidebar store of a shell, for parts that are far from the shell and
 * need to know its agents, for example the agent that works on the branch
 * of a pull request.
 */
import * as React from "react"

import type { AppShellSidebarStore } from "@/features/smith/app-shell-sidebar-store"
import {
  createSmithStore,
  useSelector,
} from "@/features/smith/tanstack-store-utils"
import type { AgentListEntry } from "@/lib/smith/api"
import { normalizeCwd } from "@/features/smith/right-sidebar-shared"

const SidebarStoreContext = React.createContext<AppShellSidebarStore | null>(
  null
)

export const SidebarStoreProvider = SidebarStoreContext.Provider

export type BranchAgent = { id: string; title: string }

/** For a part outside a shell: no agents. */
const EMPTY_STORE = createSmithStore<{
  derived?: { projectIndexes: Record<string, Array<AgentListEntry>> }
}>({})

/**
 * The agents with their own worktree in the project of `cwd`, by branch.
 * The project is the sidebar project that is `cwd`, or that has an agent
 * in `cwd`.
 */
export function useBranchAgents(cwd: string) {
  const store = React.useContext(SidebarStoreContext)
  const target = normalizeCwd(cwd)
  // A string, so that the component renders again only when it changes.
  const source: typeof EMPTY_STORE = store ?? EMPTY_STORE
  const serialized = useSelector(source, (snapshot) => {
    const indexes = snapshot.derived?.projectIndexes ?? {}
    const pairs: Array<[string, BranchAgent]> = []
    for (const [project, entries] of Object.entries(indexes)) {
      const inProject =
        normalizeCwd(project) === target ||
        entries.some((entry) => normalizeCwd(entry.cwd) === target)
      if (!inProject) continue
      for (const entry of entries) {
        if (!entry.worktreeBranch || !entry.id) continue
        pairs.push([
          entry.worktreeBranch,
          { id: entry.id, title: entry.name || entry.title },
        ])
      }
    }
    return JSON.stringify(pairs)
  })
  return React.useMemo(
    () => new Map(JSON.parse(serialized) as Array<[string, BranchAgent]>),
    [serialized]
  )
}
