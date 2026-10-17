import * as React from "react"
import {
  SessionLineage,
  useSessionInfo,
} from "@/features/pico/agent/session-lineage"
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
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  formatDisplayPath,
  formatFolderName,
  getCurrentSessionTitleFromState,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import {
  HeaderGitActions,
  HeaderGitStatusText,
} from "@/features/pico/right-sidebar-git-header-actions"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { SessionState } from "@/lib/pico"

export type AppShellSessionHeaderActions = {
  createSession: (cwdOverride?: string) => void | Promise<unknown>
  onDeleteCurrentSession: () => void
  onForkSession: () => void | Promise<unknown>
  onMoveCurrentSession: (directory: string) => void | Promise<unknown>
  onMoveCurrentSessionToAnyDirectory: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  onRenameSession: () => void
  onRunCompact: () => void | Promise<unknown>
  onToggleCurrentSessionPinned: () => void
  onToggleHideThinking: () => void | Promise<unknown>
  onToggleHideToolBlocks: () => void
  onTreeSession: () => void | Promise<unknown>
}

type AppShellSessionHeaderProps = {
  actionsRef: React.RefObject<AppShellSessionHeaderActions>
  defaultNewSessionDirectory: string
  displaySessionCwd?: string
  gitPanelOpen: boolean
  terminalPanelOpen: boolean
  loadingDisplaySessionTitle: string
  currentSessionPinned: boolean
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  isSessionViewLoading: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onToggleGitPanel: () => void
  onToggleTerminalPanel: () => void
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}

export const AppShellSessionHeader = React.memo(function AppShellSessionHeader({
  actionsRef,
  defaultNewSessionDirectory,
  displaySessionCwd,
  gitPanelOpen,
  terminalPanelOpen,
  loadingDisplaySessionTitle,
  currentSessionPinned,
  displaySettingsStore,
  isSessionViewLoading,
  newSessionDirectoryOptions,
  onToggleGitPanel,
  onToggleTerminalPanel,
  sessionStore,
  viewerContextId,
}: AppShellSessionHeaderProps) {
  const sessionHeaderState = useSelector(
    sessionStore,
    (sessionState) => ({
      firstMessage: sessionState.firstMessage,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      sessionHasFile: Boolean(sessionState.sessionFile),
      sessionName: sessionState.sessionName,
      sessionStreaming: sessionState.streaming,
      sessionId: sessionState.draft ? undefined : sessionState.sessionId,
    }),
    { compare: shallowRecordEqual }
  )
  const hideToolBlocks = useSelector(
    displaySettingsStore,
    (settings) => settings.hideToolBlocks
  )
  const displaySessionTitle = isSessionViewLoading
    ? loadingDisplaySessionTitle
    : getCurrentSessionTitleFromState(sessionHeaderState)
  const sessionInfo = useSessionInfo(
    viewerContextId,
    sessionHeaderState.sessionId
  )
  // A worktree folder has the branch name, so the branch text covers it.
  const showFolderName = Boolean(displaySessionCwd && !sessionInfo?.worktree)
  const moveSessionDirectoryOptions = newSessionDirectoryOptions.filter(
    (option) => option.path !== displaySessionCwd
  )

  return (
    <div className="sticky top-0 z-50 flex h-[var(--header-height)] w-full shrink-0 items-center border-b border-border/70 bg-background p-(--sidebar-gutter) pt-[calc(var(--sidebar-gutter)+env(safe-area-inset-top))]">
      <div className="relative flex w-full items-center gap-1">
        <SidebarTrigger className="shrink-0" />
        <TitleTooltip
          title={
            defaultNewSessionDirectory
              ? `Create a new session in ${formatDisplayPath(
                  defaultNewSessionDirectory
                )}`
              : "Create a new session"
          }
          kbd={formatShortcutLabel(appShortcut("N"))}
        >
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label="Create a new session"
            onClick={() => {
              void actionsRef.current.createSession()
            }}
          >
            <SquarePenIcon />
          </Button>
        </TitleTooltip>
        <div className="absolute left-1/2 flex w-max max-w-[calc(100%-4rem)] -translate-x-1/2 flex-col items-center justify-center gap-0 text-center">
          <div className="flex max-w-full min-w-0 items-center justify-center gap-1.5">
            {!isSessionViewLoading && sessionHeaderState.sessionStreaming ? (
              <Spinner
                size="xs"
                className="shrink-0"
                aria-label="Session streaming"
              />
            ) : null}
            <TitleTooltip title={displaySessionTitle}>
              <h2 className="min-w-0 truncate text-[13px] leading-tight font-semibold">
                {displaySessionTitle}
              </h2>
            </TitleTooltip>
          </div>
          <div className="flex max-w-full min-w-0 items-center justify-center gap-x-2">
            {showFolderName && displaySessionCwd ? (
              <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
                <span className="truncate">
                  {formatFolderName(displaySessionCwd)}
                </span>
              </span>
            ) : null}
            <HeaderGitStatusText
              viewerContextId={viewerContextId}
              className="min-w-0"
              cwd={displaySessionCwd}
            />
            <SessionLineage
              sessionId={sessionHeaderState.sessionId}
              viewerContextId={viewerContextId}
            />
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <HeaderGitActions
            viewerContextId={viewerContextId}
            cwd={displaySessionCwd}
          />
          <DropdownMenu>
            <TitleTooltip title="Session menu">
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Session menu"
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
            </TitleTooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.createSession()
                }}
              >
                <span>Create new session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("N"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              {newSessionDirectoryOptions.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    New session in…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    {newSessionDirectoryOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.path}
                        onClick={() => {
                          void actionsRef.current.createSession(option.path)
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
                        {option.path === defaultNewSessionDirectory ? (
                          <DropdownMenuShortcut>Default</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onToggleCurrentSessionPinned()
                }}
              >
                <span>
                  {currentSessionPinned
                    ? "Unpin from sidebar"
                    : "Pin to sidebar"}
                </span>
              </DropdownMenuItem>
              {sessionHeaderState.sessionHasFile ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    {moveSessionDirectoryOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.path}
                        onClick={() => {
                          void actionsRef.current.onMoveCurrentSession(
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
                        actionsRef.current.onMoveCurrentSessionToAnyDirectory()
                      }}
                    >
                      Other directory…
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onRunCompact()
                }}
              >
                <span>Compact session</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onTreeSession()
                }}
              >
                <span>Tree</span>
                <DropdownMenuShortcut>Esc Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onForkSession()
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
                  {sessionHeaderState.hideThinkingBlock
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
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onRenameSession()
                }}
              >
                <span>Rename session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("E"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onDeleteCurrentSession()
                }}
              >
                <span>Archive session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel(appShortcut("X"))}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="md:hidden"
                onClick={onToggleTerminalPanel}
              >
                <span>Terminal</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+`")}
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
            kbd={formatShortcutLabel("Control+`")}
          >
            <Button
              size="icon"
              variant="ghost"
              className="hidden md:inline-flex"
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
