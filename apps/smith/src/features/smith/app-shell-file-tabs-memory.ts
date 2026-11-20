/**
 * The open file tabs of the right sidebar, kept for each project. When the
 * user goes to an agent in another folder, the tabs of the folder before
 * stay saved, and the tabs of the new folder come back. Only the file tabs
 * change; the layout of the sidebar (open, shown tab, width) is the same for
 * all agents.
 *
 * The tabs are saved in local storage, one key for each machine, with the
 * newest `PROJECT_LIMIT` folders.
 */
import * as React from "react"

import type { AppShellRightSidebarState } from "@/features/smith/app-shell-right-sidebar-state"
import { buildRequestUrl, fetchJson } from "@/features/smith/app-shell-utils"
import {
  setStoreState,
  type SmithStore,
} from "@/features/smith/tanstack-store-utils"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/smith/storage"

const PROJECT_LIMIT = 30

export type FileTabsSnapshot = Pick<
  AppShellRightSidebarState,
  "fileTabs" | "fileActivePath" | "filePreviewPath" | "fileTreeCollapsed"
>

type StoredFileTabs = Record<string, FileTabsSnapshot & { at: number }>

const EMPTY_FILE_TABS: FileTabsSnapshot = {
  fileTabs: [],
  fileActivePath: "",
  filePreviewPath: "",
  fileTreeCollapsed: true,
}

function fileTabsKey(machineId: string) {
  return `smith-file-tabs:${machineId}`
}

function readStored(machineId: string): StoredFileTabs {
  try {
    const value = JSON.parse(
      safeLocalStorageGetItem(fileTabsKey(machineId)) ?? "{}"
    ) as unknown
    return value && typeof value === "object" ? (value as StoredFileTabs) : {}
  } catch {
    return {}
  }
}

function cleanSnapshot(value: unknown): FileTabsSnapshot {
  if (!value || typeof value !== "object") return EMPTY_FILE_TABS
  const entry = value as Partial<FileTabsSnapshot>
  const fileTabs = Array.isArray(entry.fileTabs)
    ? entry.fileTabs.filter(
        (path): path is string => typeof path === "string" && path !== ""
      )
    : []
  const filePreviewPath =
    typeof entry.filePreviewPath === "string" ? entry.filePreviewPath : ""
  const visible = filePreviewPath ? [...fileTabs, filePreviewPath] : fileTabs
  const active =
    typeof entry.fileActivePath === "string" ? entry.fileActivePath : ""
  return {
    fileTabs,
    filePreviewPath,
    fileActivePath: visible.includes(active) ? active : (visible[0] ?? ""),
    fileTreeCollapsed: entry.fileTreeCollapsed !== false,
  }
}

/** The saved file tabs of a folder, or no tabs. */
export function readFileTabs(machineId: string, cwd: string) {
  return cleanSnapshot(readStored(machineId)[cwd])
}

/** Save the file tabs of a folder. Keeps the newest folders. */
export function saveFileTabs(
  machineId: string,
  cwd: string,
  snapshot: FileTabsSnapshot
) {
  const stored = readStored(machineId)
  const empty =
    snapshot.fileTabs.length === 0 &&
    !snapshot.filePreviewPath &&
    snapshot.fileTreeCollapsed
  if (empty) delete stored[cwd]
  else stored[cwd] = { ...snapshot, at: Date.now() }
  const kept = Object.entries(stored)
    .sort(([, left], [, right]) => (right.at ?? 0) - (left.at ?? 0))
    .slice(0, PROJECT_LIMIT)
  safeLocalStorageSetItem(
    fileTabsKey(machineId),
    JSON.stringify(Object.fromEntries(kept))
  )
}

function pickFileTabs(state: AppShellRightSidebarState): FileTabsSnapshot {
  return {
    fileTabs: state.fileTabs,
    fileActivePath: state.fileActivePath,
    filePreviewPath: state.filePreviewPath,
    fileTreeCollapsed: state.fileTreeCollapsed,
  }
}

/** The snapshot without the paths in `missing`. */
export function withoutFiles(
  snapshot: FileTabsSnapshot,
  missing: Set<string>
): FileTabsSnapshot {
  if (missing.size === 0) return snapshot
  return cleanSnapshot({
    ...snapshot,
    fileTabs: snapshot.fileTabs.filter((path) => !missing.has(path)),
    filePreviewPath: missing.has(snapshot.filePreviewPath)
      ? ""
      : snapshot.filePreviewPath,
  })
}

/** Paths of the folder that the exists check can answer (not absolute). */
function relativePaths(snapshot: FileTabsSnapshot) {
  return [...new Set([...snapshot.fileTabs, snapshot.filePreviewPath])].filter(
    (path) => path && !path.startsWith("/") && !path.startsWith("~")
  )
}

/**
 * Keep the file tabs of the right sidebar for each folder: save them as
 * they change, and show the saved tabs of a folder when `cwd` changes.
 * Tabs of files that are gone close, after one check on the server.
 */
export function useRememberedFileTabs({
  store,
  machineId,
  viewerContextId,
  cwd,
}: {
  store: SmithStore<AppShellRightSidebarState>
  machineId: string
  viewerContextId: string
  cwd: string
}) {
  // The folder that the tabs in the store belong to.
  const cwdRef = React.useRef("")

  React.useEffect(() => {
    let lastSaved = ""
    const subscription = store.subscribe(() => {
      const folder = cwdRef.current
      if (!folder) return
      const snapshot = pickFileTabs(store.state)
      const text = JSON.stringify(snapshot)
      if (text === lastSaved) return
      lastSaved = text
      saveFileTabs(machineId, folder, snapshot)
    })
    return () => subscription.unsubscribe()
  }, [machineId, store])

  React.useEffect(() => {
    const restored = cwd ? readFileTabs(machineId, cwd) : EMPTY_FILE_TABS
    // Set the folder first, so the save after this change goes to it.
    cwdRef.current = cwd
    setStoreState(store, (state) => ({ ...state, ...restored }))
    const paths = cwd ? relativePaths(restored) : []
    if (paths.length === 0 || !viewerContextId) return
    let cancelled = false
    void fetchJson<{ files: Record<string, string | null> }>(
      buildRequestUrl("/api/files/exists", {
        machineId,
        contextId: viewerContextId,
      }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, paths: paths.slice(0, 200) }),
      }
    )
      .then((response) => {
        if (cancelled || cwdRef.current !== cwd) return
        const missing = new Set(
          paths.slice(0, 200).filter((path) => !response.files[path])
        )
        if (missing.size === 0) return
        setStoreState(store, (state) => ({
          ...state,
          ...withoutFiles(pickFileTabs(state), missing),
        }))
      })
      .catch(() => {
        // An offline machine keeps the tabs; the viewer shows the error.
      })
    return () => {
      cancelled = true
    }
  }, [cwd, machineId, store, viewerContextId])
}
