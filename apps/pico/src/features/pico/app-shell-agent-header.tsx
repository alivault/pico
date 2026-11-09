import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { picoQueryKeys } from "@/features/pico/query-keys"
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import type { AppShellSidebarStore } from "@/features/pico/app-shell-sidebar-store"
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
import {
  useActiveMachine,
  useMachineFeature,
  useMachineReadOnly,
  useMachines,
} from "@/features/pico/machine-store"
import { shortModelLabel, thinkingLabel } from "@/features/pico/model-label"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  ContextUsageQuotaDetails,
  ContextUsageRings,
  ContextUsageWindowDetails,
  useContextUsageView,
  type ComposerContextUsageStore,
} from "@/features/pico/context-usage"
import {
  machineHasUnreadAgents,
  useHasMachineGroups,
} from "@/features/pico/machines"

export type AppShellAgentHeaderActions = {
  createAgent: (cwdOverride?: string) => void | Promise<unknown>
  onDeleteCurrentAgent: () => void
  onForkAgent: () => void | Promise<unknown>
  onOpenCommandPalette: () => void
  onOpenModelDialog: () => void
  onOpenRightSidebarTab: (tab: "review" | "history") => void
  onOpenSettings: () => void
  onRenameAgent: () => void
  onRunCompact: () => void | Promise<unknown>
  onSelectThinkingLevel: (level: string) => void | Promise<unknown>
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
  contextUsageStore: ComposerContextUsageStore
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  isAgentViewLoading: boolean
  onToggleGitPanel: () => void
  onToggleTerminalPanel: () => void
  agentStore: PicoStore<AgentState>
  sidebarStore: AppShellSidebarStore
  viewerContextId: string
}

export const AppShellAgentHeader = React.memo(function AppShellAgentHeader({
  actionsRef,
  defaultNewAgentProject,
  displayAgentCwd,
  gitPanelOpen,
  terminalPanelOpen,
  loadingDisplayAgentTitle,
  contextUsageStore,
  displaySettingsStore,
  isAgentViewLoading,
  onToggleGitPanel,
  onToggleTerminalPanel,
  agentStore,
  sidebarStore,
  viewerContextId,
}: AppShellAgentHeaderProps) {
  const terminalsAvailable = useMachineFeature("native-pty")
  const hasMachineGroups = useHasMachineGroups()
  const activeMachine = useActiveMachine()
  const hasUnreadAgents = useHasUnreadSidebarAgents(sidebarStore)
  const agentHeaderState = useSelector(
    agentStore,
    (agentState) => ({
      firstMessage: agentState.firstMessage,
      hideThinkingBlock: agentState.hideThinkingBlock,
      agentHasFile: Boolean(agentState.agentFile),
      agentName: agentState.agentName,
      agentId: agentState.draft ? undefined : agentState.agentId,
      cwd: agentState.cwd,
      modelLabel: shortModelLabel(agentState.model, agentState.availableModels),
      thinkingLevel: agentState.thinkingLevel,
      availableThinkingLevels: agentState.availableThinkingLevels,
      modelProvider: agentState.model?.provider,
    }),
    { compare: shallowRecordEqual }
  )
  const machineReadOnly = useMachineReadOnly()
  const queryClient = useQueryClient()
  // The more button shows the context rings in place of its icon.
  const usageView = useContextUsageView({
    activeAgentId: agentHeaderState.agentId,
    contextUsageStore,
    disabled: machineReadOnly,
    modelProvider: agentHeaderState.modelProvider,
    viewerContextId,
  })
  const agentMenuTitle =
    usageView?.percent == null
      ? "Agent menu"
      : `Agent menu · ${usageView.displayPercent} of the context used`
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
  // "machine:folder", like ssh and scp, when the hub has more machines.
  const locationLabel = [
    hasMachineGroups ? (activeMachine?.label ?? "This machine") : "",
    showFolderName && displayAgentCwd ? formatFolderName(displayAgentCwd) : "",
  ]
    .filter(Boolean)
    .join(":")
  const hostname = activeMachine?.summary?.hostname
  const locationTitle = displayAgentCwd
    ? [
        formatDisplayPath(displayAgentCwd),
        hasMachineGroups
          ? `on ${activeMachine?.label ?? "this machine"}${
              hostname && hostname !== activeMachine?.label
                ? ` (${hostname})`
                : ""
            }`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : ""
  return (
    <div className="sticky top-0 z-50 flex h-[var(--header-height)] w-full shrink-0 items-center border-b border-border/70 bg-background p-(--sidebar-gutter) pt-[calc(var(--sidebar-gutter)+env(safe-area-inset-top))]">
      <div className="flex w-full min-w-0 items-center gap-1">
        <SidebarTrigger className="shrink-0" dot={hasUnreadAgents} />
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
            <TitleTooltip title={displayAgentTitle} onlyWhenTruncated>
              <h2 className="min-w-0 truncate text-[13px] leading-tight font-semibold">
                {displayAgentTitle}
              </h2>
            </TitleTooltip>
          </div>
          <div className="flex max-w-full min-w-0 items-center gap-x-1">
            {locationLabel ? (
              <TitleTooltip title={locationTitle}>
                <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
                  <span className="truncate">{locationLabel}</span>
                </span>
              </TitleTooltip>
            ) : null}
            <HeaderGitStatusText
              viewerContextId={viewerContextId}
              className={cn(locationLabel && "before:content-['·']")}
              cwd={displayAgentCwd}
              onOpenTab={(tab) => {
                actionsRef.current.onOpenRightSidebarTab(tab)
              }}
            />
            <span className="ml-1 inline-flex shrink-0 items-center gap-x-2 empty:hidden">
              <AgentLineage
                agentId={agentHeaderState.agentId}
                viewerContextId={viewerContextId}
              />
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          <DropdownMenu
            onOpenChange={(open) => {
              // The session and weekly usage change with each request, so
              // the menu gets them again when it opens.
              if (open)
                void queryClient.invalidateQueries({
                  queryKey: picoQueryKeys.providerUsageAll(),
                })
            }}
          >
            <TitleTooltip title={agentMenuTitle}>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="relative"
                    aria-label={
                      usageView
                        ? `Agent menu. ${usageView.ariaLabel}`
                        : "Agent menu"
                    }
                  />
                }
              >
                {usageView ? (
                  <ContextUsageRings
                    view={usageView}
                    className="absolute inset-0 size-full"
                  />
                ) : (
                  <EllipsisIcon />
                )}
              </DropdownMenuTrigger>
            </TitleTooltip>
            <DropdownMenuContent align="end" className="w-64">
              {usageView ? (
                <>
                  <DropdownMenuItem
                    className="block"
                    onClick={() =>
                      emitPicoEvent("pico:open-agent-settings", {
                        page: "agent-context",
                      })
                    }
                  >
                    <ContextUsageWindowDetails view={usageView} />
                  </DropdownMenuItem>
                  <ContextUsageQuotaDetails view={usageView} />
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                disabled={machineReadOnly}
                onClick={() => {
                  actionsRef.current.onOpenModelDialog()
                }}
              >
                <span className="shrink-0">Model</span>
                <span className="ml-auto min-w-0 truncate text-muted-foreground">
                  {agentHeaderState.modelLabel}
                </span>
                <DropdownMenuShortcut className="ml-2">
                  {formatShortcutLabel(appShortcut("M"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              {agentHeaderState.availableThinkingLevels.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={machineReadOnly}>
                    <span className="flex-1">Reasoning</span>
                    <span className="text-muted-foreground">
                      {thinkingLabel(agentHeaderState.thinkingLevel)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuRadioGroup
                      value={agentHeaderState.thinkingLevel}
                      onValueChange={(level: string) => {
                        void actionsRef.current.onSelectThinkingLevel(level)
                      }}
                    >
                      {agentHeaderState.availableThinkingLevels.map((level) => (
                        <DropdownMenuRadioItem key={level} value={level}>
                          {thinkingLabel(level)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <ProfileMenuSub
                cwd={displayAgentCwd || agentHeaderState.cwd}
                agentId={agentHeaderState.agentId}
                viewerContextId={viewerContextId}
              />
              <DropdownMenuSeparator />
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

/**
 * On mobile, the sidebar is hidden, so its toggle shows a dot when an agent
 * in the sidebar is done and not read: on the shown machine, or on another
 * machine of the hub.
 */
function useHasUnreadSidebarAgents(sidebarStore: AppShellSidebarStore) {
  const { isMobile } = useSidebar()
  const activeMachine = useActiveMachine()
  const { machines } = useMachines()
  const shownMachineUnread = useSelector(sidebarStore, (snapshot) =>
    snapshot.derived.sidebarAgents.some(
      (agent) => Boolean(agent.unread) && !agent.streaming
    )
  )
  if (!isMobile) return false
  if (shownMachineUnread) return true
  return machines.some(
    (machine) =>
      machine.id !== activeMachine?.id && machineHasUnreadAgents(machine)
  )
}
