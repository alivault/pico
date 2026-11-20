import type { RightSidebarTabValue } from "@/features/smith/right-sidebar-types"
import {
  setStoreField,
  setStoreState,
  type SmithStore,
} from "@/features/smith/tanstack-store-utils"
import {
  RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/smith"

export type OpenFileViewTabOptions = { pin?: boolean }

export type AppShellRightSidebarState = {
  activeTab: RightSidebarTabValue
  fileActivePath: string
  filePreviewPath: string
  fileTabs: Array<string>
  fileTreeCollapsed: boolean
}

function readStoredRightSidebarActiveTab(): RightSidebarTabValue {
  const stored = safeLocalStorageGetItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY)
  return stored === "files" ||
    stored === "review" ||
    stored === "agent" ||
    stored === "browser" ||
    stored === "issues"
    ? stored
    : "review"
}

function storeRightSidebarActiveTab(tab: RightSidebarTabValue) {
  if (tab === "commit-diff" || tab === "history") return
  safeLocalStorageSetItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY, tab)
}

export function setRightSidebarActiveTab(
  store: SmithStore<AppShellRightSidebarState>,
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
    fileTreeCollapsed: true,
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
  store: SmithStore<AppShellRightSidebarState>
) {
  setStoreState(store, (state) => ({
    ...state,
    fileActivePath: "",
    filePreviewPath: "",
    fileTabs: [],
    fileTreeCollapsed: true,
  }))
}

export function openRightSidebarFile(
  store: SmithStore<AppShellRightSidebarState>,
  path: string,
  options?: OpenFileViewTabOptions
) {
  if (!path) return

  storeRightSidebarActiveTab("files")
  setStoreState(store, (state) => {
    // Only an explicit pin (a double-click, as in VS Code) keeps a
    // preview tab. Opening the preview file again does not pin it.
    const shouldPin = Boolean(options?.pin) || state.fileTabs.includes(path)
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
      // The file tree starts collapsed when the first file opens. After
      // that, keep the user's choice.
      fileTreeCollapsed: selectRightSidebarHasVisibleFiles(state)
        ? state.fileTreeCollapsed
        : true,
    }
  })
}

/** Make the preview tab of `path` a pinned tab. Do not change the shown tab. */
export function pinRightSidebarFile(
  store: SmithStore<AppShellRightSidebarState>,
  path: string
) {
  setStoreState(store, (state) =>
    state.filePreviewPath !== path
      ? state
      : {
          ...state,
          filePreviewPath: "",
          fileTabs: state.fileTabs.includes(path)
            ? state.fileTabs
            : [...state.fileTabs, path],
        }
  )
}

export function closeRightSidebarFile(
  store: SmithStore<AppShellRightSidebarState>,
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
  store: SmithStore<AppShellRightSidebarState>,
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
  store: SmithStore<AppShellRightSidebarState>,
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
  store: SmithStore<AppShellRightSidebarState>
) {
  setStoreState(store, (state) => ({
    ...state,
    fileActivePath: "",
    filePreviewPath: "",
    fileTabs: [],
  }))
}

export function reorderRightSidebarFiles(
  store: SmithStore<AppShellRightSidebarState>,
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
