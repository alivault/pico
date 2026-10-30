import * as React from "react"
import { ProfileMenuSub } from "@/features/pico/agent/profiles"
import { AgentLineage, useAgentInfo } from "@/features/pico/agent/agent-lineage"
import {
  EllipsisIcon,
  PanelRightIcon,
  SquarePenIcon,
  SquareTerminalIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  formatDisplayPath,
  formatFolderName,
  getCurrentAgentTitleFromState,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import { HeaderGitStatusText } from "@/features/pico/right-sidebar-git-header-actions"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { AgentState } from "@/lib/pico"
import { cn } from "@/lib/utils"
import { useMachineFeature } from "@/features/pico/machine-store"

export type AppShellAgentHeaderActions = {
  createAgent: (cwdOverride?: string) => void | Promise<unknown>
  onDeleteCurrentAgent: () => void
  onForkAgent: () => void | Promise<unknown>
  onMoveCurrentAgent: (project: string) => void | Promise<unknown>
  onMoveCurrentAgentToAnyProject: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  onRenameAgent: () => void
  onRunCompact: () => void | Promise<unknown>
  onToggleCurrentAgentPinned: () => void
  onToggleHideThinking: () => void | Promise<unknown>
  onToggleHideToolBlocks: () => void
  onTreeAgent: () => void | Promise<unknown>
}

type AppShellAgentHeaderProps = {
  actionsRef: React.RefObject<AppShellAgentHeaderActions>
  defaultNewAgentProject: string
  displayAgentCwd?: string
  gitPanelOpen: boolean
  terminalPanelOpen: boolean
  loadingDisplayAgentTitle: string
  currentAgentPinned: boolean
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  isAgentViewLoading: boolean
  newAgentProjectOptions: Array<{ path: string; label: string }>
  onToggleGitPanel: () => void
  onToggleTerminalPanel: () => void
  agentStore: PicoStore<AgentState>
  viewerContextId: string
}

export const AppShellAgentHeader = React.memo(function AppShellAgentHeader({
  actionsRef,
  defaultNewAgentProject,
  displayAgentCwd,
  gitPanelOpen,
  terminalPanelOpen,
  loadingDisplayAgentTitle,
  currentAgentPinned,
  displaySettingsStore,
  isAgentViewLoading,
  newAgentProjectOptions,
  onToggleGitPanel,
  onToggleTerminalPanel,
  agentStore,
  viewerContextId,
}: AppShellAgentHeaderProps) {
  const terminalsAvailable = useMachineFeature("native-pty")
  const agentHeaderState = useSelector(
    agentStore,
    (agentState) => ({
      firstMessage: agentState.firstMessage,
      hideThinkingBlock: agentState.hideThinkingBlock,
      agentHasFile: Boolean(agentState.agentFile),
      agentName: agentState.agentName,
      agentId: agentState.draft ? undefined : agentState.agentId,
    }),
    { compare: shallowRecordEqual }
  )
  const hideToolBlocks = useSelector(
    displaySettingsStore,
    (settings) => settings.hideToolBlocks
  )
  const displayAgentTitle = isAgentViewLoading
    ? loadingDisplayAgentTitle
    : getCurrentAgentTitleFromState(agentHeaderState)
  const agentInfo = useAgentInfo(viewerContextId, agentHeaderState.agentId)
  // A worktree folder has the branch name, so the branch text covers it.
  const showFolderName = Boolean(displayAgentCwd && !agentInfo?.worktree)
  const moveAgentProjectOptions = newAgentProjectOptions.filter(
    (option) => option.path !== displayAgentCwd
  )

  return (
    <div className="sticky top-0 z-50 flex h-[var(--header-height)] w-full shrink-0 items-center border-b border-border/70 bg-background p-(--sidebar-gutter) pt-[calc(var(--sidebar-gutter)+env(safe-area-inset-top))]">
      <div className="flex w-full min-w-0 items-center gap-1">
        <SidebarTrigger className="shrink-0" />
        <TitleTooltip
          title={
            defaultNewAgentProject
              ? `Create a new agent in ${formatDisplayPath(
                  defaultNewAgentProject
                )}`
              : "Create a new agent"
          }
          kbd={formatShortcutLabel(appShortcut("N"))}
        >
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label="Create a new agent"
            onClick={() => {
              void actionsRef.current.createAgent()
            }}
          >
            <SquarePenIcon />
          </Button>
        </TitleTooltip>
        <div className="ml-1 flex min-w-0 flex-1 flex-col items-start justify-center gap-0 text-left">
          <div className="flex max-w-full min-w-0 items-center gap-1.5">
            <TitleTooltip title={displayAgentTitle}>
              <h2 className="min-w-0 truncate text-[13px] leading-tight font-semibold">
                {displayAgentTitle}
              </h2>
            </TitleTooltip>
          </div>
          <div className="flex max-w-full min-w-0 items-center gap-x-2">
            {showFolderName && displayAgentCwd ? (
              <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
                <span className="truncate">
                  {formatFolderName(displayAgentCwd)}
                </span>
              </span>
            ) : null}
            <HeaderGitStatusText
              viewerContextId={viewerContextId}
              className="min-w-0"
              cwd={displayAgentCwd}
            />
            <AgentLineage
              agentId={agentHeaderState.agentId}
              viewerContextId={viewerContextId}
            />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          <DropdownMenu>
            <TitleTooltip title="Agent menu">
              <DropdownMenuTrigger
                render={
                  <Button size="icon" variant="ghost" aria-label="Agent menu" />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
            </TitleTooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.createAgent()
                }}
              >
                <span>Create new agent</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("N"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              {newAgentProjectOptions.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>New agent in…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    {newAgentProjectOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.path}
                        onClick={() => {
                          void actionsRef.current.createAgent(option.path)
                        }}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">
                            {option.label}
                          </span>
                          <span className="truncate">
                            {formatDisplayPath(option.path)}
                          </span>
                        </div>
                        {option.path === defaultNewAgentProject ? (
                          <DropdownMenuShortcut>Default</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!agentHeaderState.agentHasFile}
                onClick={() => {
                  actionsRef.current.onToggleCurrentAgentPinned()
                }}
              >
                <span>
                  {currentAgentPinned ? "Unpin from sidebar" : "Pin to sidebar"}
                </span>
              </DropdownMenuItem>
              {agentHeaderState.agentHasFile ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    {moveAgentProjectOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.path}
                        onClick={() => {
                          void actionsRef.current.onMoveCurrentAgent(
                            option.path
                          )
                        }}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">
                            {option.label}
                          </span>
                          <span className="truncate">
                            {formatDisplayPath(option.path)}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      onClick={() => {
                        actionsRef.current.onMoveCurrentAgentToAnyProject()
                      }}
                    >
                      Other project…
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onRunCompact()
                }}
              >
                <span>Compact conversation</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onTreeAgent()
                }}
              >
                <span>Tree</span>
                <DropdownMenuShortcut>Esc Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onForkAgent()
                }}
              >
                <span>Fork</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("F"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onToggleHideThinking()
                }}
              >
                <span>
                  {agentHeaderState.hideThinkingBlock
                    ? "Show thinking"
                    : "Hide thinking"}
                </span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("T"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onToggleHideToolBlocks()
                }}
              >
                <span>{hideToolBlocks ? "Show tools" : "Hide tools"}</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("O"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!agentHeaderState.agentHasFile}
                onClick={() => {
                  actionsRef.current.onRenameAgent()
                }}
              >
                <span>Rename agent</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("E"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!agentHeaderState.agentHasFile}
                onClick={() => {
                  actionsRef.current.onDeleteCurrentAgent()
                }}
              >
                <span>Archive agent</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("X"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {agentHeaderState.agentId ? (
                <ProfileMenuSub
                  className="md:hidden"
                  cwd={displayAgentCwd}
                  agentId={agentHeaderState.agentId}
                  viewerContextId={viewerContextId}
                />
              ) : null}
              <DropdownMenuItem
                className={cn("md:hidden", !terminalsAvailable && "hidden")}
                onClick={onToggleTerminalPanel}
              >
                <span>Terminal</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("J"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onOpenCommandPalette()
                }}
              >
                <span>Commands</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("K"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onOpenSettings()
                }}
              >
                <span>Settings</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut(","))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TitleTooltip
            title="Toggle terminal"
            kbd={formatShortcutLabel(appShortcut("J"))}
          >
            <Button
              size="icon"
              variant="ghost"
              className={cn("hidden", terminalsAvailable && "md:inline-flex")}
              aria-pressed={terminalPanelOpen}
              aria-label="Toggle terminal panel"
              onClick={onToggleTerminalPanel}
            >
              <SquareTerminalIcon />
            </Button>
          </TitleTooltip>
          <TitleTooltip
            title="Toggle right sidebar"
            kbd={formatShortcutLabel(appShortcut("\\"))}
          >
            <Button
              size="icon"
              variant="ghost"
              className="hidden md:inline-flex"
              aria-pressed={gitPanelOpen}
              aria-label="Toggle right sidebar"
              onClick={onToggleGitPanel}
            >
              <PanelRightIcon />
            </Button>
          </TitleTooltip>
        </div>
      </div>
    </div>
  )
})
