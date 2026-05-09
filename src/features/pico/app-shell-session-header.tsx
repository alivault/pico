import * as React from "react"
import { EllipsisIcon, PanelRightIcon, SquarePenIcon } from "lucide-react"

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
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  formatDisplayPath,
  formatFolderName,
  getCurrentSessionTitleFromState,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellDisplaySettingsState } from "@/features/pico/app-shell-types"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
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
  onRenameSession: () => void
  onRunCompact: () => void | Promise<unknown>
  onToggleHideThinking: () => void | Promise<unknown>
  onToggleHideToolBlocks: () => void
  onTreeSession: () => void | Promise<unknown>
}

type AppShellSessionHeaderProps = {
  actionsRef: React.RefObject<AppShellSessionHeaderActions>
  defaultNewSessionDirectory: string
  displaySessionCwd?: string
  gitPanelOpen: boolean
  loadingDisplaySessionTitle: string
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  isSessionViewLoading: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onToggleGitPanel: () => void
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}

export const AppShellSessionHeader = React.memo(function AppShellSessionHeader({
  actionsRef,
  defaultNewSessionDirectory,
  displaySessionCwd,
  gitPanelOpen,
  loadingDisplaySessionTitle,
  displaySettingsStore,
  isSessionViewLoading,
  newSessionDirectoryOptions,
  onToggleGitPanel,
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
    }),
    { compare: shallowRecordEqual }
  )
  const hideToolBlocks = useSelector(
    displaySettingsStore,
    (settings) => settings.hideToolBlocks
  )
  const {
    isMobile: sidebarIsMobile,
    openMobile: sidebarOpenMobile,
    state: sidebarState,
  } = useSidebar()
  const sidebarOpen = sidebarIsMobile
    ? sidebarOpenMobile
    : sidebarState === "expanded"
  const showCollapsedNewSessionButton = !sidebarOpen
  const displaySessionTitle = isSessionViewLoading
    ? loadingDisplaySessionTitle
    : getCurrentSessionTitleFromState(sessionHeaderState)

  return (
    <div className="sticky top-0 z-50 flex min-h-[var(--header-height)] w-full shrink-0 items-center border-b border-border/70 bg-background p-2">
      <div className="relative flex w-full items-center gap-1">
        <SidebarTrigger
          variant={sidebarOpen ? "secondary" : "ghost"}
          className="shrink-0"
        />
        {showCollapsedNewSessionButton ? (
          <TitleTooltip
            title={
              defaultNewSessionDirectory
                ? `Create a new session in ${formatDisplayPath(
                    defaultNewSessionDirectory
                  )}`
                : "Create a new session"
            }
            kbd={formatShortcutLabel("Control+N")}
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
        ) : null}
        <div className="absolute left-1/2 flex w-max max-w-[calc(100%-4rem)] -translate-x-1/2 flex-col items-center justify-center gap-0 text-center">
          <div className="flex max-w-full min-w-0 items-center justify-center gap-1.5">
            {!isSessionViewLoading && sessionHeaderState.sessionStreaming ? (
              <Spinner
                className="size-3.5 shrink-0"
                aria-label="Session streaming"
              />
            ) : null}
            <TitleTooltip title={displaySessionTitle}>
              <h2 className="min-w-0 truncate text-[13px] leading-tight font-semibold">
                {displaySessionTitle}
              </h2>
            </TitleTooltip>
          </div>
          <div className="flex max-w-full min-w-0 items-center justify-center gap-x-3">
            {displaySessionCwd ? (
              <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
                <span className="truncate">
                  {formatFolderName(displaySessionCwd)}
                </span>
              </span>
            ) : null}
            <HeaderGitStatusText
              viewerContextId={viewerContextId}
              cwd={displaySessionCwd}
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
                  {formatShortcutLabel("Control+N")}
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
                  {formatShortcutLabel("Control+F")}
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
                  {formatShortcutLabel("Control+T")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onToggleHideToolBlocks()
                }}
              >
                <span>{hideToolBlocks ? "Show tools" : "Hide tools"}</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+O")}
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
                  {formatShortcutLabel("Control+E")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onDeleteCurrentSession()
                }}
              >
                <span>Delete session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+X")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TitleTooltip
            title="Toggle right sidebar"
            kbd={formatShortcutLabel("Control+\\")}
          >
            <Button
              size="icon"
              variant={gitPanelOpen ? "secondary" : "ghost"}
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
