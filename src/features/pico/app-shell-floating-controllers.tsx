import * as React from "react"
import { toast } from "sonner"

import {
  AppShellAddDirectoryDialogController,
  type AppShellAddDirectoryDialogHandle,
} from "@/features/pico/app-shell-add-directory-dialog"
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
  AppShellSessionsDialogController,
  type AppShellSessionsDialogHandle,
} from "@/features/pico/app-shell-sessions-dialog"
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
  SelectSessionNavigationOptions,
} from "@/features/pico/app-shell-types"
import { GitCommitDialogController } from "@/features/pico/right-sidebar-git-commit-dialog"
import type { GitCommitDialogControllerHandle } from "@/features/pico/right-sidebar-types"
import {
  DeleteOldDirectorySessionsDialogController,
  DeleteSessionsDialogController,
  ForkSessionDialogController,
  RenameSessionDialogController,
  type DeleteOldDirectorySessionsDialogHandle,
  type DeleteSessionsDialogHandle,
  type ForkSessionDialogHandle,
  type RenameSessionDialogHandle,
} from "@/features/pico/app-shell-session-dialogs"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { SessionState, ThemeColorMode, ThemeFamily } from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"
import type {
  DirectorySearchResponse,
  PathCompletionsResponse,
} from "@/lib/pico/api"

type AppShellFloatingControllersProps = {
  activeSessionId?: string
  addDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  addDirectoryOpenRef: React.RefObject<boolean>
  addDirectoryPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  baseSidebarDirectories: Array<string>
  commandPaletteCommandsRef: React.RefObject<() => Array<AppCommand>>
  commandPaletteOpenRef: React.RefObject<boolean>
  commandPaletteRef: React.RefObject<AppShellCommandPaletteHandle | null>
  currentSessionQueryScope: string
  currentTheme: ThemeFamily
  currentThemeColorMode: ThemeColorMode
  authDialogRef: React.RefObject<AppShellAuthDialogHandle | null>
  authOpenRef: React.RefObject<boolean>
  deleteDialogRef: React.RefObject<DeleteSessionsDialogHandle | null>
  deleteOpenRef: React.RefObject<boolean>
  deleteSessions: React.ComponentProps<
    typeof DeleteSessionsDialogController
  >["onDeleteSession"]
  deleteOldDirectorySessionsDialogRef: React.RefObject<DeleteOldDirectorySessionsDialogHandle | null>
  deleteOldDirectorySessionsOpenRef: React.RefObject<boolean>
  notificationStore: PicoStore<AppShellNotificationState>
  forkDialogRef: React.RefObject<ForkSessionDialogHandle | null>
  forkOpenRef: React.RefObject<boolean>
  gitCommitDialogRef: React.RefObject<GitCommitDialogControllerHandle | null>
  gitCommitOpenRef: React.RefObject<boolean>
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  knownDirectories: Array<string>
  moveSessionDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  moveSessionDirectoryOpenRef: React.RefObject<boolean>
  moveSessionDirectoryTargetToPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  onAutoScrollEnabledChange: (enabled: boolean) => void
  onCenterMessagesChange: (centered: boolean) => void
  onHideThinkingBlocksChange: (hidden: boolean) => void
  onHideToolBlocksChange: (hidden: boolean) => void
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  onSessionDialogSelect: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
  onThemeChange: (value: ThemeFamily) => void
  onThemeColorModeChange: (value: ThemeColorMode) => void
  onThemePreviewChange: (value: ThemeFamily, colorMode: ThemeColorMode) => void
  recentDirectoriesStore: PicoStore<Array<string>>
  renameDialogRef: React.RefObject<RenameSessionDialogHandle | null>
  renameOpenRef: React.RefObject<boolean>
  renameSessionPath: React.ComponentProps<
    typeof RenameSessionDialogController
  >["onRenameSession"]
  sessionCwd?: string
  sessionsDialogDirectory: string
  sessionsDialogRef: React.RefObject<AppShellSessionsDialogHandle | null>
  sessionsOpenRef: React.RefObject<boolean>
  sessionStore: PicoStore<SessionState>
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

const AppShellSessionsDialogHost = React.memo(
  function AppShellSessionsDialogHost({
    activeSessionId,
    knownDirectories,
    sessionsDialogDirectory,
    sessionsDialogRef,
    sessionsOpenRef,
    sidebarStore,
    viewerContextId,
    deleteSessions,
    onSessionDialogSelect,
    renameSessionPath,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "knownDirectories"
    | "sessionsDialogDirectory"
    | "sessionsDialogRef"
    | "sessionsOpenRef"
    | "sidebarStore"
    | "viewerContextId"
    | "deleteSessions"
    | "onSessionDialogSelect"
    | "renameSessionPath"
  >) {
    const sessionsDialogSnapshot = useAppShellSidebarValue(
      sidebarStore,
      (snapshot) => ({
        activeSessionId:
          snapshot.state.sessionsEvent?.activeSessionId || activeSessionId,
        activeSessionPath:
          snapshot.state.sessionsEvent?.activeSessionPath || "",
        directorySessionsByPath: snapshot.derived.sidebarDirectoryIndexes,
        sessionStatusByKey: snapshot.state.sidebarSessionStatusByKey,
      })
    )

    return (
      <AppShellSessionsDialogController
        ref={sessionsDialogRef}
        openStateRef={sessionsOpenRef}
        viewerContextId={viewerContextId}
        currentDirectory={sessionsDialogDirectory}
        knownDirectories={knownDirectories}
        directorySessionsByPath={sessionsDialogSnapshot.directorySessionsByPath}
        sessionStatusByKey={sessionsDialogSnapshot.sessionStatusByKey}
        activeSessionId={sessionsDialogSnapshot.activeSessionId}
        activeSessionPath={sessionsDialogSnapshot.activeSessionPath}
        onSelectSession={onSessionDialogSelect}
        onRenameSession={renameSessionPath}
        onDeleteSession={deleteSessions}
        onError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to load sessions"
          )
        }}
      />
    )
  }
)

const AppShellAddDirectoryDialogHost = React.memo(
  function AppShellAddDirectoryDialogHost({
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    activeSessionId,
    addDirectoryPath,
    baseSidebarDirectories,
    knownDirectories,
    recentDirectoriesStore,
    sessionCwd,
    sessionStore,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "addDirectoryDialogRef"
    | "addDirectoryOpenRef"
    | "addDirectoryPath"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "recentDirectoriesStore"
    | "sessionCwd"
    | "sessionStore"
    | "viewerContextId"
  >) {
    const recentDirectories = useSelector(recentDirectoriesStore)
    const useForNewSession = useSelector(
      sessionStore,
      (sessionState) => sessionState.draft && sessionState.items.length === 0
    )
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
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
          contextId: viewerContextId,
          sessionId: activeSessionId,
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
        currentDirectory={sessionCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        useForNewSession={useForNewSession}
        onAddDirectoryPath={addDirectoryPath}
        onRequestPathCompletions={requestPathCompletions}
        onSearchDirectories={searchDirectories}
      />
    )
  }
)

const AppShellMoveSessionDirectoryDialogHost = React.memo(
  function AppShellMoveSessionDirectoryDialogHost({
    activeSessionId,
    baseSidebarDirectories,
    knownDirectories,
    moveSessionDirectoryDialogRef,
    moveSessionDirectoryOpenRef,
    moveSessionDirectoryTargetToPath,
    recentDirectoriesStore,
    sessionCwd,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "moveSessionDirectoryDialogRef"
    | "moveSessionDirectoryOpenRef"
    | "moveSessionDirectoryTargetToPath"
    | "recentDirectoriesStore"
    | "sessionCwd"
    | "viewerContextId"
  >) {
    const recentDirectories = useSelector(recentDirectoriesStore)
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
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
          contextId: viewerContextId,
          sessionId: activeSessionId,
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
        ref={moveSessionDirectoryDialogRef}
        openStateRef={moveSessionDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={sessionCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        useForMoveSession
        onAddDirectoryPath={moveSessionDirectoryTargetToPath}
        onRequestPathCompletions={requestPathCompletions}
        onSearchDirectories={searchDirectories}
      />
    )
  }
)

const AppShellRenameSessionDialogHost = React.memo(
  function AppShellRenameSessionDialogHost({
    renameDialogRef,
    renameOpenRef,
    renameSessionPath,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "renameDialogRef"
    | "renameOpenRef"
    | "renameSessionPath"
    | "viewerContextId"
  >) {
    return (
      <RenameSessionDialogController
        ref={renameDialogRef}
        openStateRef={renameOpenRef}
        viewerContextId={viewerContextId}
        onRenameSession={renameSessionPath}
      />
    )
  }
)

const AppShellDeleteSessionsDialogHost = React.memo(
  function AppShellDeleteSessionsDialogHost({
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
  }: Pick<
    AppShellFloatingControllersProps,
    "deleteDialogRef" | "deleteOpenRef" | "deleteSessions"
  >) {
    return (
      <DeleteSessionsDialogController
        ref={deleteDialogRef}
        openStateRef={deleteOpenRef}
        onDeleteSession={deleteSessions}
      />
    )
  }
)

const AppShellDeleteOldDirectorySessionsDialogHost = React.memo(
  function AppShellDeleteOldDirectorySessionsDialogHost({
    deleteOldDirectorySessionsDialogRef,
    deleteOldDirectorySessionsOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "deleteOldDirectorySessionsDialogRef"
    | "deleteOldDirectorySessionsOpenRef"
    | "viewerContextId"
  >) {
    return (
      <DeleteOldDirectorySessionsDialogController
        ref={deleteOldDirectorySessionsDialogRef}
        openStateRef={deleteOldDirectorySessionsOpenRef}
        viewerContextId={viewerContextId}
      />
    )
  }
)

const AppShellForkSessionDialogHost = React.memo(
  function AppShellForkSessionDialogHost({
    activeSessionId,
    currentSessionQueryScope,
    forkDialogRef,
    forkOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "currentSessionQueryScope"
    | "forkDialogRef"
    | "forkOpenRef"
    | "viewerContextId"
  >) {
    return (
      <ForkSessionDialogController
        ref={forkDialogRef}
        openStateRef={forkOpenRef}
        viewerContextId={viewerContextId}
        sessionScopeKey={currentSessionQueryScope}
        sessionId={activeSessionId}
      />
    )
  }
)

const AppShellTreeDialogHost = React.memo(function AppShellTreeDialogHost({
  activeSessionId,
  currentSessionQueryScope,
  sessionStore,
  treeDialogRef,
  treeOpenRef,
  viewerContextId,
}: Pick<
  AppShellFloatingControllersProps,
  | "activeSessionId"
  | "currentSessionQueryScope"
  | "sessionStore"
  | "treeDialogRef"
  | "treeOpenRef"
  | "viewerContextId"
>) {
  const treeSummaryAvailable = useSelector(
    sessionStore,
    (sessionState) => sessionState.availableModels.length > 0
  )
  const activeSessionStreaming = useSelector(
    sessionStore,
    (sessionState) => sessionState.streaming
  )

  return (
    <AppShellTreeDialogController
      ref={treeDialogRef}
      openStateRef={treeOpenRef}
      viewerContextId={viewerContextId}
      sessionScopeKey={currentSessionQueryScope}
      sessionId={activeSessionId}
      treeSummaryAvailable={treeSummaryAvailable}
      activeSessionStreaming={activeSessionStreaming}
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
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onThemeChange,
    onThemeColorModeChange,
    onThemePreviewChange,
    sessionStore,
    settingsDialogRef,
    settingsOpenRef,
    systemTheme,
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
    | "onSessionDoneDesktopNotificationsEnabledChange"
    | "onSessionDoneSoundEnabledChange"
    | "onThemeChange"
    | "onThemeColorModeChange"
    | "onThemePreviewChange"
    | "sessionStore"
    | "settingsDialogRef"
    | "settingsOpenRef"
    | "systemTheme"
  >) {
    const hideThinkingBlocks = useSelector(
      sessionStore,
      (sessionState) => sessionState.hideThinkingBlock
    )
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useSelector(displaySettingsStore)
    const {
      desktopNotificationPermission,
      sessionDoneDesktopNotificationsEnabled,
      sessionDoneSoundEnabled,
    } = useSelector(
      notificationStore,
      (state) => ({
        desktopNotificationPermission: state.desktopNotificationPermission,
        sessionDoneDesktopNotificationsEnabled:
          state.sessionDoneDesktopNotificationsEnabled,
        sessionDoneSoundEnabled: state.sessionDoneSoundEnabled,
      }),
      { compare: shallowRecordEqual }
    )

    const openAuthFromSettings = (mode: "login" | "logout") => {
      settingsDialogRef.current?.close()
      authDialogRef.current?.open(mode, {
        returnOnClose: () => settingsDialogRef.current?.open(),
      })
    }

    return (
      <AppShellSettingsDialogController
        ref={settingsDialogRef}
        openStateRef={settingsOpenRef}
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
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          onSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
        onLoginProviders={() => openAuthFromSettings("login")}
        onLogoutProviders={() => openAuthFromSettings("logout")}
      />
    )
  }
)

const AppShellUiRequestDialogHost = React.memo(
  function AppShellUiRequestDialogHost({
    activeSessionId,
    authDialogRef,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
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
        sessionId={activeSessionId}
        onAuthBack={() => authDialogRef.current?.open("login")}
      />
    )
  }
)

export const AppShellFloatingControllers = React.memo(
  function AppShellFloatingControllers({
    activeSessionId,
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    addDirectoryPath,
    baseSidebarDirectories,
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
    currentSessionQueryScope,
    currentTheme,
    currentThemeColorMode,
    authDialogRef,
    authOpenRef,
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
    deleteOldDirectorySessionsDialogRef,
    deleteOldDirectorySessionsOpenRef,
    notificationStore,
    forkDialogRef,
    forkOpenRef,
    gitCommitDialogRef,
    gitCommitOpenRef,
    displaySettingsStore,
    knownDirectories,
    moveSessionDirectoryDialogRef,
    moveSessionDirectoryOpenRef,
    moveSessionDirectoryTargetToPath,
    onAutoScrollEnabledChange,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onSessionDialogSelect,
    onThemeChange,
    onThemeColorModeChange,
    onThemePreviewChange,
    recentDirectoriesStore,
    renameDialogRef,
    renameOpenRef,
    renameSessionPath,
    sessionCwd,
    sessionsDialogDirectory,
    sessionsDialogRef,
    sessionsOpenRef,
    sessionStore,
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
          cwd={sessionCwd}
        />

        <AppShellAuthDialogController
          ref={authDialogRef}
          openStateRef={authOpenRef}
          viewerContextId={viewerContextId}
          sessionId={activeSessionId}
        />

        <AppShellSessionsDialogHost
          activeSessionId={activeSessionId}
          knownDirectories={knownDirectories}
          sessionsDialogDirectory={sessionsDialogDirectory}
          sessionsDialogRef={sessionsDialogRef}
          sessionsOpenRef={sessionsOpenRef}
          sidebarStore={sidebarStore}
          viewerContextId={viewerContextId}
          deleteSessions={deleteSessions}
          onSessionDialogSelect={onSessionDialogSelect}
          renameSessionPath={renameSessionPath}
        />

        <AppShellAddDirectoryDialogHost
          activeSessionId={activeSessionId}
          addDirectoryDialogRef={addDirectoryDialogRef}
          addDirectoryOpenRef={addDirectoryOpenRef}
          addDirectoryPath={addDirectoryPath}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          recentDirectoriesStore={recentDirectoriesStore}
          sessionCwd={sessionCwd}
          sessionStore={sessionStore}
          viewerContextId={viewerContextId}
        />

        <AppShellMoveSessionDirectoryDialogHost
          activeSessionId={activeSessionId}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          moveSessionDirectoryDialogRef={moveSessionDirectoryDialogRef}
          moveSessionDirectoryOpenRef={moveSessionDirectoryOpenRef}
          moveSessionDirectoryTargetToPath={moveSessionDirectoryTargetToPath}
          recentDirectoriesStore={recentDirectoriesStore}
          sessionCwd={sessionCwd}
          viewerContextId={viewerContextId}
        />

        <AppShellRenameSessionDialogHost
          renameDialogRef={renameDialogRef}
          renameOpenRef={renameOpenRef}
          renameSessionPath={renameSessionPath}
          viewerContextId={viewerContextId}
        />

        <AppShellDeleteSessionsDialogHost
          deleteDialogRef={deleteDialogRef}
          deleteOpenRef={deleteOpenRef}
          deleteSessions={deleteSessions}
        />

        <AppShellDeleteOldDirectorySessionsDialogHost
          deleteOldDirectorySessionsDialogRef={
            deleteOldDirectorySessionsDialogRef
          }
          deleteOldDirectorySessionsOpenRef={deleteOldDirectorySessionsOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellForkSessionDialogHost
          activeSessionId={activeSessionId}
          currentSessionQueryScope={currentSessionQueryScope}
          forkDialogRef={forkDialogRef}
          forkOpenRef={forkOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellTreeDialogHost
          activeSessionId={activeSessionId}
          currentSessionQueryScope={currentSessionQueryScope}
          sessionStore={sessionStore}
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
          onSessionDoneDesktopNotificationsEnabledChange={
            onSessionDoneDesktopNotificationsEnabledChange
          }
          onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
          onThemeChange={onThemeChange}
          onThemeColorModeChange={onThemeColorModeChange}
          onThemePreviewChange={onThemePreviewChange}
          sessionStore={sessionStore}
          settingsDialogRef={settingsDialogRef}
          settingsOpenRef={settingsOpenRef}
          systemTheme={systemTheme}
        />

        <AppShellUiRequestDialogHost
          activeSessionId={activeSessionId}
          authDialogRef={authDialogRef}
          uiRequestDialogRef={uiRequestDialogRef}
          uiRequestOpenRef={uiRequestOpenRef}
          viewerContextId={viewerContextId}
        />
      </>
    )
  }
)
