/**
 * Files that the user edits in the right sidebar. There is one store for each
 * machine, so a draft stays when its tab or shell is not shown. A file is in
 * edit mode while it has an entry. The entry is dirty while its draft is not
 * the same as the content that the editor started from.
 */
import {
  createPicoStore,
  setStoreState,
  shallow,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"

export type ProjectFileEdit = {
  cwd: string
  path: string
  /** The file content on disk when the edit started or was last saved. */
  baseContent: string
  /** The server version of `baseContent`. A save sends it to see conflicts. */
  baseVersion: string
  draft: string
  /** Changes when the draft is replaced from outside the editor. */
  revision: number
}

type ProjectFileEditsState = Record<string, ProjectFileEdit>

const stores = new Map<string, PicoStore<ProjectFileEditsState>>()

function editStore(machineId: string) {
  let store = stores.get(machineId)
  if (!store) {
    store = createPicoStore<ProjectFileEditsState>({})
    stores.set(machineId, store)
  }
  return store
}

// The browser asks before it closes or reloads the page with unsaved files.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (hasDirtyProjectFiles()) event.preventDefault()
  })
}

const editKey = (cwd: string, path: string) => `${cwd}\u0000${path}`

export function isProjectFileEditDirty(edit: ProjectFileEdit | undefined) {
  return Boolean(edit && edit.draft !== edit.baseContent)
}

export function useProjectFileEdit(
  machineId: string,
  cwd: string,
  path: string
): ProjectFileEdit | undefined {
  return useSelector(editStore(machineId), (state) => state[editKey(cwd, path)])
}

export function getProjectFileEdit(
  machineId: string,
  cwd: string,
  path: string
): ProjectFileEdit | undefined {
  return editStore(machineId).state[editKey(cwd, path)]
}

/** The paths in `cwd` that have unsaved changes. */
export function useDirtyProjectFilePaths(machineId: string, cwd: string) {
  return useSelector(editStore(machineId), (state) => dirtyPaths(state, cwd), {
    compare: shallow,
  })
}

function dirtyPaths(state: ProjectFileEditsState, cwd: string) {
  return Object.values(state)
    .filter((edit) => edit.cwd === cwd && isProjectFileEditDirty(edit))
    .map((edit) => edit.path)
    .sort()
}

export function getDirtyProjectFilePaths(machineId: string, cwd: string) {
  return dirtyPaths(editStore(machineId).state, cwd)
}

/** True when any file on any machine has unsaved changes. */
export function hasDirtyProjectFiles() {
  for (const store of stores.values())
    if (Object.values(store.state).some(isProjectFileEditDirty)) return true
  return false
}

function updateEdit(
  machineId: string,
  cwd: string,
  path: string,
  update: (edit: ProjectFileEdit | undefined) => ProjectFileEdit | undefined
) {
  const key = editKey(cwd, path)
  setStoreState(editStore(machineId), (state) => {
    const current = state[key]
    const next = update(current)
    if (next === current) return state
    if (!next) {
      const { [key]: _removed, ...rest } = state
      return rest
    }
    return { ...state, [key]: next }
  })
}

export function startProjectFileEdit(
  machineId: string,
  file: { cwd: string; path: string; content: string; version: string }
) {
  updateEdit(
    machineId,
    file.cwd,
    file.path,
    (current) =>
      current ?? {
        cwd: file.cwd,
        path: file.path,
        baseContent: file.content,
        baseVersion: file.version,
        draft: file.content,
        revision: 0,
      }
  )
}

export function setProjectFileDraft(
  machineId: string,
  cwd: string,
  path: string,
  draft: string
) {
  updateEdit(machineId, cwd, path, (current) =>
    current && current.draft !== draft ? { ...current, draft } : current
  )
}

/**
 * Set a new base after a save or a reload. With `replaceDraft`, the draft
 * becomes the new content and the editor shows it.
 */
export function rebaseProjectFileEdit(
  machineId: string,
  file: { cwd: string; path: string; content: string; version: string },
  replaceDraft: boolean
) {
  updateEdit(machineId, file.cwd, file.path, (current) => {
    if (!current) return current
    if (
      current.baseVersion === file.version &&
      current.baseContent === file.content &&
      (!replaceDraft || current.draft === file.content)
    )
      return current
    return {
      ...current,
      baseContent: file.content,
      baseVersion: file.version,
      draft: replaceDraft ? file.content : current.draft,
      revision: replaceDraft ? current.revision + 1 : current.revision,
    }
  })
}

export function endProjectFileEdit(
  machineId: string,
  cwd: string,
  path: string
) {
  updateEdit(machineId, cwd, path, () => undefined)
}

/** End the edits of these paths in `cwd`, for example when their tabs close. */
export function endProjectFileEdits(
  machineId: string,
  cwd: string,
  paths: Array<string>
) {
  for (const path of paths) endProjectFileEdit(machineId, cwd, path)
}
