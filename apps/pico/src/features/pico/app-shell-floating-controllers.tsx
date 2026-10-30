import * as React from "react"
import "@/features/pico/agent/register"
import { AgentSettingsDialogController } from "@/features/pico/agent/agent-settings-dialog"
import { ResourcesDialogController } from "@/features/pico/resources-dialog"
import { usePicoEvent } from "@/features/pico/agent/events"
import { toast } from "@/lib/pico/toast"

import {
  AppShellAddDirectoryDialogController,
  type AppShellAddDirectoryDialogHandle,
} from "@/features/pico/app-shell-add-project-dialog"
import {
  AppShellAuthDialogController,
  type AppShellAuthDialogHandle,
} from "@/features/pico/app-shell-auth-dialog"
import {
  AppShellCommandPaletteController,
  type AppShellCommandPaletteHandle,
} from "@/features/pico/app-shell-command-palette"
import type { AppCommand } from "@/features/pico/app-shell-command-palette"
import {
  AppShellAgentsDialogController,
  type AppShellAgentsDialogHandle,
} from "@/features/pico/app-shell-agents-dialog"
import {
  AppShellSettingsDialogController,
  type AppShellSettingsDialogHandle,
} from "@/features/pico/app-shell-settings-dialog"
import {
  AppShellTreeDialogController,
  type AppShellTreeDialogHandle,
} from "@/features/pico/app-shell-tree-dialog"
import {
  AppShellUiRequestDialogController,
  type AppShellUiRequestDialogHandle,
} from "@/features/pico/app-shell-ui-request-dialog"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  useStableEvent,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellSidebarStore } from "@/features/pico/app-shell-sidebar-store"
import { useAppShellSidebarValue } from "@/features/pico/app-shell-sidebar-store"
import type {
  AppShellDisplaySettingsState,
  AppShellNotificationState,
  SelectAgentNavigationOptions,
} from "@/features/pico/app-shell-types"
import { GitCommitDialogController } from "@/features/pico/right-sidebar-git-commit-dialog"
import type { GitCommitDialogControllerHandle } from "@/features/pico/right-sidebar-types"
import {
  DeleteOldDirectoryAgentsDialogController,
  DeleteAgentsDialogController,
  ForkAgentDialogController,
  RenameAgentDialogController,
  type DeleteOldDirectoryAgentsDialogHandle,
  type DeleteAgentsDialogHandle,
  type ForkAgentDialogHandle,
  type RenameAgentDialogHandle,
} from "@/features/pico/app-shell-agent-dialogs"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { AgentState, ThemeColorMode, ThemeFamily } from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"
import type {
  DirectorySearchResponse,
  PathCompletionsResponse,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"

type AppShellFloatingControllersProps = {
  activeAgentId?: string
  addDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  addDirectoryOpenRef: React.RefObject<boolean>
  addDirectoryPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  baseSidebarDirectories: Array<string>
  commandPaletteCommandsRef: React.RefObject<() => Array<AppCommand>>
  commandPaletteOpenRef: React.RefObject<boolean>
  commandPaletteRef: React.RefObject<AppShellCommandPaletteHandle | null>
  currentAgentQueryScope: string
  currentTheme: ThemeFamily
  currentThemeColorMode: ThemeColorMode
  authDialogRef: React.RefObject<AppShellAuthDialogHandle | null>
  authOpenRef: React.RefObject<boolean>
  deleteDialogRef: React.RefObject<DeleteAgentsDialogHandle | null>
  deleteOpenRef: React.RefObject<boolean>
  deleteAgents: React.ComponentProps<
    typeof DeleteAgentsDialogController
  >["onDeleteAgent"]
  deleteOldDirectoryAgentsDialogRef: React.RefObject<DeleteOldDirectoryAgentsDialogHandle | null>
  deleteOldDirectoryAgentsOpenRef: React.RefObject<boolean>
  notificationStore: PicoStore<AppShellNotificationState>
  forkDialogRef: React.RefObject<ForkAgentDialogHandle | null>
  forkOpenRef: React.RefObject<boolean>
  gitCommitDialogRef: React.RefObject<GitCommitDialogControllerHandle | null>
  gitCommitOpenRef: React.RefObject<boolean>
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  knownDirectories: Array<string>
  moveAgentDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  moveAgentDirectoryOpenRef: React.RefObject<boolean>
  moveAgentDirectoryTargetToPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  onAutoScrollEnabledChange: (enabled: boolean) => void
  onCenterMessagesChange: (centered: boolean) => void
  onHideThinkingBlocksChange: (hidden: boolean) => void
  onHideToolBlocksChange: (hidden: boolean) => void
  onAgentDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  onAgentDoneSoundEnabledChange: (enabled: boolean) => void
  onAgentDialogSelect: (
    agentId?: string,
    options?: SelectAgentNavigationOptions
  ) => void
  onThemeChange: (value: ThemeFamily) => void
  onThemeColorModeChange: (value: ThemeColorMode) => void
  onThemePreviewChange: (value: ThemeFamily, colorMode: ThemeColorMode) => void
  recentDirectoriesStore: PicoStore<Array<string>>
  renameDialogRef: React.RefObject<RenameAgentDialogHandle | null>
  renameOpenRef: React.RefObject<boolean>
  renameAgentPath: React.ComponentProps<
    typeof RenameAgentDialogController
  >["onRenameAgent"]
  agentCwd?: string
  agentsDialogDirectory: string
  agentsDialogRef: React.RefObject<AppShellAgentsDialogHandle | null>
  agentsOpenRef: React.RefObject<boolean>
  agentStore: PicoStore<AgentState>
  settingsDialogRef: React.RefObject<AppShellSettingsDialogHandle | null>
  settingsOpenRef: React.RefObject<boolean>
  sidebarStore: AppShellSidebarStore
  treeDialogRef: React.RefObject<AppShellTreeDialogHandle | null>
  treeOpenRef: React.RefObject<boolean>
  uiRequestDialogRef: React.RefObject<AppShellUiRequestDialogHandle | null>
  uiRequestOpenRef: React.RefObject<boolean>
  viewerContextId: string
  systemTheme?: string
}

const AppShellCommandPaletteHost = React.memo(
  function AppShellCommandPaletteHost({
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
  }: Pick<
    AppShellFloatingControllersProps,
    "commandPaletteCommandsRef" | "commandPaletteOpenRef" | "commandPaletteRef"
  >) {
    return (
      <AppShellCommandPaletteController
        ref={commandPaletteRef}
        openStateRef={commandPaletteOpenRef}
        getCommandsRef={commandPaletteCommandsRef}
        onCommandError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to run command"
          )
        }}
      />
    )
  }
)

const AppShellAgentsDialogHost = React.memo(function AppShellAgentsDialogHost({
  activeAgentId,
  knownDirectories,
  agentsDialogDirectory,
  agentsDialogRef,
  agentsOpenRef,
  sidebarStore,
  viewerContextId,
  deleteAgents,
  onAgentDialogSelect,
  renameAgentPath,
}: Pick<
  AppShellFloatingControllersProps,
  | "activeAgentId"
  | "knownDirectories"
  | "agentsDialogDirectory"
  | "agentsDialogRef"
  | "agentsOpenRef"
  | "sidebarStore"
  | "viewerContextId"
  | "deleteAgents"
  | "onAgentDialogSelect"
  | "renameAgentPath"
>) {
  const agentsDialogSnapshot = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => ({
      activeAgentId: snapshot.state.agentsEvent?.activeAgentId || activeAgentId,
      activeAgentPath: snapshot.state.agentsEvent?.activeAgentPath || "",
      directoryAgentsByPath: snapshot.derived.sidebarDirectoryIndexes,
      agentStatusByKey: snapshot.state.sidebarAgentStatusByKey,
    })
  )

  return (
    <AppShellAgentsDialogController
      ref={agentsDialogRef}
      openStateRef={agentsOpenRef}
      viewerContextId={viewerContextId}
      currentDirectory={agentsDialogDirectory}
      knownDirectories={knownDirectories}
      directoryAgentsByPath={agentsDialogSnapshot.directoryAgentsByPath}
      agentStatusByKey={agentsDialogSnapshot.agentStatusByKey}
      activeAgentId={agentsDialogSnapshot.activeAgentId}
      activeAgentPath={agentsDialogSnapshot.activeAgentPath}
      onSelectAgent={onAgentDialogSelect}
      onRenameAgent={renameAgentPath}
      onDeleteAgent={deleteAgents}
      onError={(error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to load agents"
        )
      }}
    />
  )
})

const AppShellAddDirectoryDialogHost = React.memo(
  function AppShellAddDirectoryDialogHost({
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    activeAgentId,
    addDirectoryPath,
    baseSidebarDirectories,
    knownDirectories,
    recentDirectoriesStore,
    agentCwd,
    agentStore,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeAgentId"
    | "addDirectoryDialogRef"
    | "addDirectoryOpenRef"
    | "addDirectoryPath"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "recentDirectoriesStore"
    | "agentCwd"
    | "agentStore"
    | "viewerContextId"
  >) {
    const machineId = useMachineId()
    const recentDirectories = useSelector(recentDirectoriesStore)
    const useForNewAgent = useSelector(
      agentStore,
      (agentState) => agentState.draft && agentState.items.length === 0
    )
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })
    const searchDirectories = useStableEvent(async (query: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<DirectorySearchResponse>(
        buildRequestUrl("/api/directory-search", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })

    return (
      <AppShellAddDirectoryDialogController
        ref={addDirectoryDialogRef}
        openStateRef={addDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={agentCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        useForNewAgent={useForNewAgent}
        onAddDirectoryPath={addDirectoryPath}
        onRequestPathCompletions={requestPathCompletions}
        onSearchDirectories={searchDirectories}
      />
    )
  }
)

const AppShellMoveAgentDirectoryDialogHost = React.memo(
  function AppShellMoveAgentDirectoryDialogHost({
    activeAgentId,
    baseSidebarDirectories,
    knownDirectories,
    moveAgentDirectoryDialogRef,
    moveAgentDirectoryOpenRef,
    moveAgentDirectoryTargetToPath,
    recentDirectoriesStore,
    agentCwd,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeAgentId"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "moveAgentDirectoryDialogRef"
    | "moveAgentDirectoryOpenRef"
    | "moveAgentDirectoryTargetToPath"
    | "recentDirectoriesStore"
    | "agentCwd"
    | "viewerContextId"
  >) {
    const machineId = useMachineId()
    const recentDirectories = useSelector(recentDirectoriesStore)
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })
    const searchDirectories = useStableEvent(async (query: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<DirectorySearchResponse>(
        buildRequestUrl("/api/directory-search", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })

    return (
      <AppShellAddDirectoryDialogController
        ref={moveAgentDirectoryDialogRef}
        openStateRef={moveAgentDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={agentCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        useForMoveAgent
        onAddDirectoryPath={moveAgentDirectoryTargetToPath}
        onRequestPathCompletions={requestPathCompletions}
        onSearchDirectories={searchDirectories}
      />
    )
  }
)

const AppShellRenameAgentDialogHost = React.memo(
  function AppShellRenameAgentDialogHost({
    renameDialogRef,
    renameOpenRef,
    renameAgentPath,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    "renameDialogRef" | "renameOpenRef" | "renameAgentPath" | "viewerContextId"
  >) {
    return (
      <RenameAgentDialogController
        ref={renameDialogRef}
        openStateRef={renameOpenRef}
        viewerContextId={viewerContextId}
        onRenameAgent={renameAgentPath}
      />
    )
  }
)

const AppShellDeleteAgentsDialogHost = React.memo(
  function AppShellDeleteAgentsDialogHost({
    deleteDialogRef,
    deleteOpenRef,
    deleteAgents,
  }: Pick<
    AppShellFloatingControllersProps,
    "deleteDialogRef" | "deleteOpenRef" | "deleteAgents"
  >) {
    return (
      <DeleteAgentsDialogController
        ref={deleteDialogRef}
        openStateRef={deleteOpenRef}
        onDeleteAgent={deleteAgents}
      />
    )
  }
)

const AppShellDeleteOldDirectoryAgentsDialogHost = React.memo(
  function AppShellDeleteOldDirectoryAgentsDialogHost({
    deleteOldDirectoryAgentsDialogRef,
    deleteOldDirectoryAgentsOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "deleteOldDirectoryAgentsDialogRef"
    | "deleteOldDirectoryAgentsOpenRef"
    | "viewerContextId"
  >) {
    return (
      <DeleteOldDirectoryAgentsDialogController
        ref={deleteOldDirectoryAgentsDialogRef}
        openStateRef={deleteOldDirectoryAgentsOpenRef}
        viewerContextId={viewerContextId}
      />
    )
  }
)

const AppShellForkAgentDialogHost = React.memo(
  function AppShellForkAgentDialogHost({
    activeAgentId,
    currentAgentQueryScope,
    forkDialogRef,
    forkOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeAgentId"
    | "currentAgentQueryScope"
    | "forkDialogRef"
    | "forkOpenRef"
    | "viewerContextId"
  >) {
    return (
      <ForkAgentDialogController
        ref={forkDialogRef}
        openStateRef={forkOpenRef}
        viewerContextId={viewerContextId}
        agentScopeKey={currentAgentQueryScope}
        agentId={activeAgentId}
      />
    )
  }
)

const AppShellTreeDialogHost = React.memo(function AppShellTreeDialogHost({
  activeAgentId,
  currentAgentQueryScope,
  agentStore,
  treeDialogRef,
  treeOpenRef,
  viewerContextId,
}: Pick<
  AppShellFloatingControllersProps,
  | "activeAgentId"
  | "currentAgentQueryScope"
  | "agentStore"
  | "treeDialogRef"
  | "treeOpenRef"
  | "viewerContextId"
>) {
  const treeSummaryAvailable = useSelector(
    agentStore,
    (agentState) => agentState.availableModels.length > 0
  )
  const activeAgentStreaming = useSelector(
    agentStore,
    (agentState) => agentState.streaming
  )

  return (
    <AppShellTreeDialogController
      ref={treeDialogRef}
      openStateRef={treeOpenRef}
      viewerContextId={viewerContextId}
      agentScopeKey={currentAgentQueryScope}
      agentId={activeAgentId}
      treeSummaryAvailable={treeSummaryAvailable}
      activeAgentStreaming={activeAgentStreaming}
    />
  )
})

const AppShellSettingsDialogHost = React.memo(
  function AppShellSettingsDialogHost({
    authDialogRef,
    currentTheme,
    currentThemeColorMode,
    displaySettingsStore,
    notificationStore,
    onAutoScrollEnabledChange,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onAgentDoneDesktopNotificationsEnabledChange,
    onAgentDoneSoundEnabledChange,
    onThemeChange,
    onThemeColorModeChange,
    onThemePreviewChange,
    agentStore,
    settingsDialogRef,
    settingsOpenRef,
    systemTheme,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "authDialogRef"
    | "currentTheme"
    | "currentThemeColorMode"
    | "displaySettingsStore"
    | "notificationStore"
    | "onAutoScrollEnabledChange"
    | "onCenterMessagesChange"
    | "onHideThinkingBlocksChange"
    | "onHideToolBlocksChange"
    | "onAgentDoneDesktopNotificationsEnabledChange"
    | "onAgentDoneSoundEnabledChange"
    | "onThemeChange"
    | "onThemeColorModeChange"
    | "onThemePreviewChange"
    | "agentStore"
    | "settingsDialogRef"
    | "settingsOpenRef"
    | "systemTheme"
    | "viewerContextId"
  >) {
    const hideThinkingBlocks = useSelector(
      agentStore,
      (agentState) => agentState.hideThinkingBlock
    )
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useSelector(displaySettingsStore)
    const {
      desktopNotificationPermission,
      agentDoneDesktopNotificationsEnabled,
      agentDoneSoundEnabled,
    } = useSelector(
      notificationStore,
      (state) => ({
        desktopNotificationPermission: state.desktopNotificationPermission,
        agentDoneDesktopNotificationsEnabled:
          state.agentDoneDesktopNotificationsEnabled,
        agentDoneSoundEnabled: state.agentDoneSoundEnabled,
      }),
      { compare: shallowRecordEqual }
    )

    usePicoEvent("pico:open-agent-settings", () => {
      settingsDialogRef.current?.close()
    })

    const openAuthFromSettings = (mode: "login" | "logout") => {
      settingsDialogRef.current?.close()
      authDialogRef.current?.open(mode, {
        returnOnClose: () => settingsDialogRef.current?.open(),
      })
    }

    return (
      <>
        <AgentSettingsDialogController viewerContextId={viewerContextId} />
        <ResourcesDialogController viewerContextId={viewerContextId} />
        <AppShellSettingsDialogController
          ref={settingsDialogRef}
          openStateRef={settingsOpenRef}
          viewerContextId={viewerContextId}
          currentTheme={currentTheme}
          currentThemeColorMode={currentThemeColorMode}
          onThemeChange={onThemeChange}
          onThemeColorModeChange={onThemeColorModeChange}
          onThemePreviewChange={onThemePreviewChange}
          systemTheme={systemTheme}
          hideThinkingBlocks={hideThinkingBlocks}
          onHideThinkingBlocksChange={onHideThinkingBlocksChange}
          hideToolBlocks={hideToolBlocks}
          onHideToolBlocksChange={onHideToolBlocksChange}
          centerMessages={centerMessages}
          onCenterMessagesChange={onCenterMessagesChange}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollEnabledChange={onAutoScrollEnabledChange}
          agentDoneSoundEnabled={agentDoneSoundEnabled}
          onAgentDoneSoundEnabledChange={onAgentDoneSoundEnabledChange}
          agentDoneDesktopNotificationsEnabled={
            agentDoneDesktopNotificationsEnabled
          }
          onAgentDoneDesktopNotificationsEnabledChange={
            onAgentDoneDesktopNotificationsEnabledChange
          }
          desktopNotificationPermission={desktopNotificationPermission}
          onLoginProviders={() => openAuthFromSettings("login")}
          onLogoutProviders={() => openAuthFromSettings("logout")}
        />
      </>
    )
  }
)

const AppShellUiRequestDialogHost = React.memo(
  function AppShellUiRequestDialogHost({
    activeAgentId,
    authDialogRef,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeAgentId"
    | "authDialogRef"
    | "uiRequestDialogRef"
    | "uiRequestOpenRef"
    | "viewerContextId"
  >) {
    return (
      <AppShellUiRequestDialogController
        ref={uiRequestDialogRef}
        openStateRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
        agentId={activeAgentId}
        onAuthBack={() => authDialogRef.current?.open("login")}
      />
    )
  }
)

export const AppShellFloatingControllers = React.memo(
  function AppShellFloatingControllers({
    activeAgentId,
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    addDirectoryPath,
    baseSidebarDirectories,
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
    currentAgentQueryScope,
    currentTheme,
    currentThemeColorMode,
    authDialogRef,
    authOpenRef,
    deleteDialogRef,
    deleteOpenRef,
    deleteAgents,
    deleteOldDirectoryAgentsDialogRef,
    deleteOldDirectoryAgentsOpenRef,
    notificationStore,
    forkDialogRef,
    forkOpenRef,
    gitCommitDialogRef,
    gitCommitOpenRef,
    displaySettingsStore,
    knownDirectories,
    moveAgentDirectoryDialogRef,
    moveAgentDirectoryOpenRef,
    moveAgentDirectoryTargetToPath,
    onAutoScrollEnabledChange,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onAgentDoneDesktopNotificationsEnabledChange,
    onAgentDoneSoundEnabledChange,
    onAgentDialogSelect,
    onThemeChange,
    onThemeColorModeChange,
    onThemePreviewChange,
    recentDirectoriesStore,
    renameDialogRef,
    renameOpenRef,
    renameAgentPath,
    agentCwd,
    agentsDialogDirectory,
    agentsDialogRef,
    agentsOpenRef,
    agentStore,
    settingsDialogRef,
    settingsOpenRef,
    sidebarStore,
    treeDialogRef,
    treeOpenRef,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
    systemTheme,
  }: AppShellFloatingControllersProps) {
    return (
      <>
        <AppShellCommandPaletteHost
          commandPaletteCommandsRef={commandPaletteCommandsRef}
          commandPaletteOpenRef={commandPaletteOpenRef}
          commandPaletteRef={commandPaletteRef}
        />

        <GitCommitDialogController
          ref={gitCommitDialogRef}
          openStateRef={gitCommitOpenRef}
          viewerContextId={viewerContextId}
          cwd={agentCwd}
        />

        <AppShellAuthDialogController
          ref={authDialogRef}
          openStateRef={authOpenRef}
          viewerContextId={viewerContextId}
          agentId={activeAgentId}
        />

        <AppShellAgentsDialogHost
          activeAgentId={activeAgentId}
          knownDirectories={knownDirectories}
          agentsDialogDirectory={agentsDialogDirectory}
          agentsDialogRef={agentsDialogRef}
          agentsOpenRef={agentsOpenRef}
          sidebarStore={sidebarStore}
          viewerContextId={viewerContextId}
          deleteAgents={deleteAgents}
          onAgentDialogSelect={onAgentDialogSelect}
          renameAgentPath={renameAgentPath}
        />

        <AppShellAddDirectoryDialogHost
          activeAgentId={activeAgentId}
          addDirectoryDialogRef={addDirectoryDialogRef}
          addDirectoryOpenRef={addDirectoryOpenRef}
          addDirectoryPath={addDirectoryPath}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          recentDirectoriesStore={recentDirectoriesStore}
          agentCwd={agentCwd}
          agentStore={agentStore}
          viewerContextId={viewerContextId}
        />

        <AppShellMoveAgentDirectoryDialogHost
          activeAgentId={activeAgentId}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          moveAgentDirectoryDialogRef={moveAgentDirectoryDialogRef}
          moveAgentDirectoryOpenRef={moveAgentDirectoryOpenRef}
          moveAgentDirectoryTargetToPath={moveAgentDirectoryTargetToPath}
          recentDirectoriesStore={recentDirectoriesStore}
          agentCwd={agentCwd}
          viewerContextId={viewerContextId}
        />

        <AppShellRenameAgentDialogHost
          renameDialogRef={renameDialogRef}
          renameOpenRef={renameOpenRef}
          renameAgentPath={renameAgentPath}
          viewerContextId={viewerContextId}
        />

        <AppShellDeleteAgentsDialogHost
          deleteDialogRef={deleteDialogRef}
          deleteOpenRef={deleteOpenRef}
          deleteAgents={deleteAgents}
        />

        <AppShellDeleteOldDirectoryAgentsDialogHost
          deleteOldDirectoryAgentsDialogRef={deleteOldDirectoryAgentsDialogRef}
          deleteOldDirectoryAgentsOpenRef={deleteOldDirectoryAgentsOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellForkAgentDialogHost
          activeAgentId={activeAgentId}
          currentAgentQueryScope={currentAgentQueryScope}
          forkDialogRef={forkDialogRef}
          forkOpenRef={forkOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellTreeDialogHost
          activeAgentId={activeAgentId}
          currentAgentQueryScope={currentAgentQueryScope}
          agentStore={agentStore}
          treeDialogRef={treeDialogRef}
          treeOpenRef={treeOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellSettingsDialogHost
          authDialogRef={authDialogRef}
          currentTheme={currentTheme}
          currentThemeColorMode={currentThemeColorMode}
          displaySettingsStore={displaySettingsStore}
          notificationStore={notificationStore}
          onAutoScrollEnabledChange={onAutoScrollEnabledChange}
          onCenterMessagesChange={onCenterMessagesChange}
          onHideThinkingBlocksChange={onHideThinkingBlocksChange}
          onHideToolBlocksChange={onHideToolBlocksChange}
          onAgentDoneDesktopNotificationsEnabledChange={
            onAgentDoneDesktopNotificationsEnabledChange
          }
          onAgentDoneSoundEnabledChange={onAgentDoneSoundEnabledChange}
          onThemeChange={onThemeChange}
          onThemeColorModeChange={onThemeColorModeChange}
          onThemePreviewChange={onThemePreviewChange}
          agentStore={agentStore}
          settingsDialogRef={settingsDialogRef}
          settingsOpenRef={settingsOpenRef}
          systemTheme={systemTheme}
          viewerContextId={viewerContextId}
        />

        <AppShellUiRequestDialogHost
          activeAgentId={activeAgentId}
          authDialogRef={authDialogRef}
          uiRequestDialogRef={uiRequestDialogRef}
          uiRequestOpenRef={uiRequestOpenRef}
          viewerContextId={viewerContextId}
        />
      </>
    )
  }
)
