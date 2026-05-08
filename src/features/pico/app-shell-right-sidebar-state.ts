import type { RightSidebarTabValue } from "@/features/pico/right-sidebar-types"
import {
  setStoreField,
  setStoreState,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico"

export type OpenFileViewTabOptions = { pin?: boolean }

export type AppShellRightSidebarState = {
  activeTab: RightSidebarTabValue
  fileActivePath: string
  filePreviewPath: string
  fileTabs: Array<string>
  fileTreeCollapsed: boolean
}

function normalizeRightSidebarActiveTab(value: unknown): RightSidebarTabValue {
  return value === "files" || value === "review" ? value : "review"
}

function readStoredRightSidebarActiveTab(): RightSidebarTabValue {
  return normalizeRightSidebarActiveTab(
    safeLocalStorageGetItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY)
  )
}

function storeRightSidebarActiveTab(tab: RightSidebarTabValue) {
  safeLocalStorageSetItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY, tab)
}

export function setRightSidebarActiveTab(
  store: PicoStore<AppShellRightSidebarState>,
  tab: RightSidebarTabValue
) {
  setStoreField(store, "activeTab", tab)
  storeRightSidebarActiveTab(tab)
}

export function createInitialRightSidebarState(): AppShellRightSidebarState {
  return {
    activeTab: readStoredRightSidebarActiveTab(),
    fileActivePath: "",
    filePreviewPath: "",
    fileTabs: [],
    fileTreeCollapsed: false,
  }
}

export function selectRightSidebarVisibleFileTabs(
  state: AppShellRightSidebarState
) {
  return state.filePreviewPath &&
    !state.fileTabs.includes(state.filePreviewPath)
    ? [...state.fileTabs, state.filePreviewPath]
    : state.fileTabs
}

export function selectRightSidebarHasVisibleFiles(
  state: AppShellRightSidebarState
) {
  return selectRightSidebarVisibleFileTabs(state).length > 0
}

export function resetRightSidebarFiles(
  store: PicoStore<AppShellRightSidebarState>
) {
  setStoreState(store, (state) => ({
    ...state,
    fileActivePath: "",
    filePreviewPath: "",
    fileTabs: [],
    fileTreeCollapsed: false,
  }))
}

export function openRightSidebarFile(
  store: PicoStore<AppShellRightSidebarState>,
  path: string,
  options?: OpenFileViewTabOptions
) {
  if (!path) return

  storeRightSidebarActiveTab("files")
  setStoreState(store, (state) => {
    const shouldPin =
      Boolean(options?.pin) ||
      state.fileTabs.includes(path) ||
      state.fileActivePath === path
    const fileTabs = shouldPin
      ? state.fileTabs.includes(path)
        ? state.fileTabs
        : [...state.fileTabs, path]
      : state.fileTabs
    const filePreviewPath = shouldPin
      ? state.filePreviewPath === path
        ? ""
        : state.filePreviewPath
      : path

    return {
      ...state,
      activeTab: "files" as RightSidebarTabValue,
      fileActivePath: path,
      filePreviewPath,
      fileTabs,
      fileTreeCollapsed: false,
    }
  })
}

export function closeRightSidebarFile(
  store: PicoStore<AppShellRightSidebarState>,
  path: string
) {
  setStoreState(store, (state) => {
    const visibleTabs = selectRightSidebarVisibleFileTabs(state)
    const index = visibleTabs.indexOf(path)
    const fileTabs = state.fileTabs.filter((tab) => tab !== path)
    const filePreviewPath =
      state.filePreviewPath === path ? "" : state.filePreviewPath
    const nextVisibleTabs =
      filePreviewPath && !fileTabs.includes(filePreviewPath)
        ? [...fileTabs, filePreviewPath]
        : fileTabs
    const fileActivePath =
      state.fileActivePath === path
        ? nextVisibleTabs[Math.max(0, index - 1)] || nextVisibleTabs[0] || ""
        : state.fileActivePath

    return {
      ...state,
      fileActivePath,
      filePreviewPath,
      fileTabs,
    }
  })
}

export function closeOtherRightSidebarFiles(
  store: PicoStore<AppShellRightSidebarState>,
  path: string
) {
  setStoreState(store, (state) => {
    const pinned = state.fileTabs.includes(path) ? [path] : []
    return {
      ...state,
      fileActivePath: path,
      filePreviewPath: pinned.length === 0 ? path : "",
      fileTabs: pinned,
    }
  })
}

export function closeRightSidebarFilesToRight(
  store: PicoStore<AppShellRightSidebarState>,
  path: string
) {
  setStoreState(store, (state) => {
    const visibleTabs = selectRightSidebarVisibleFileTabs(state)
    const index = visibleTabs.indexOf(path)
    if (index < 0) return state

    const keep = new Set(visibleTabs.slice(0, index + 1))
    const fileTabs = state.fileTabs.filter((tab) => keep.has(tab))
    const filePreviewPath = keep.has(state.filePreviewPath)
      ? state.filePreviewPath
      : ""
    const nextVisibleTabs =
      filePreviewPath && !fileTabs.includes(filePreviewPath)
        ? [...fileTabs, filePreviewPath]
        : fileTabs

    return {
      ...state,
      fileActivePath: nextVisibleTabs.includes(state.fileActivePath)
        ? state.fileActivePath
        : path,
      filePreviewPath,
      fileTabs,
    }
  })
}

export function closeAllRightSidebarFiles(
  store: PicoStore<AppShellRightSidebarState>
) {
  setStoreState(store, (state) => ({
    ...state,
    fileActivePath: "",
    filePreviewPath: "",
    fileTabs: [],
  }))
}

export function reorderRightSidebarFiles(
  store: PicoStore<AppShellRightSidebarState>,
  paths: Array<string>
) {
  const uniquePaths = paths.filter(
    (path, index) => path && paths.indexOf(path) === index
  )
  if (uniquePaths.length === 0) return

  setStoreState(store, (state) => ({
    ...state,
    fileActivePath: uniquePaths.includes(state.fileActivePath)
      ? state.fileActivePath
      : uniquePaths[0] || "",
    filePreviewPath: "",
    fileTabs: uniquePaths,
  }))
}
