/**
 * Edit mode for a project file in the right sidebar: start and end an edit,
 * save it, and follow changes on disk.
 */
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  endProjectFileEdit,
  getProjectFileEdit,
  isProjectFileEditDirty,
  rebaseProjectFileEdit,
  setProjectFileDraft,
  startProjectFileEdit,
  useProjectFileEdit,
} from "@/features/pico/project-file-edits"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { getErrorMessage } from "@/features/pico/right-sidebar-shared"
import type {
  ProjectFileReadResponse,
  ProjectFileWriteResponse,
} from "@/lib/pico/api"
import { toast } from "@/lib/pico/toast"

type ProjectFileReadData = Extract<ProjectFileReadResponse, { ok: true }>
type ProjectFileWriteData = Extract<ProjectFileWriteResponse, { ok: true }>

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) || path
}

export function useProjectFileEditing({
  machineId,
  viewerContextId,
  cwd,
  path,
  file,
  refetch,
}: {
  machineId: string
  viewerContextId: string
  cwd: string
  path: string
  /** The file as the server last read it. */
  file: ProjectFileReadData | undefined
  refetch: () => Promise<{ data?: ProjectFileReadData }>
}) {
  const queryClient = useQueryClient()
  const edit = useProjectFileEdit(machineId, cwd, path)
  const dirty = isProjectFileEditDirty(edit)
  const [starting, setStarting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  /** The file changed on disk after the edit started or was last saved. */
  const diskChanged = Boolean(edit && file && file.version !== edit.baseVersion)

  // Without local changes, the editor follows the file on disk.
  React.useEffect(() => {
    if (!edit || !file || file.version === edit.baseVersion || dirty) return
    rebaseProjectFileEdit(
      machineId,
      { cwd, path, content: file.content, version: file.version },
      true
    )
  }, [cwd, dirty, edit, file, machineId, path])

  const startEdit = async () => {
    if (edit || starting) return
    setStarting(true)
    try {
      // Start from the newest content, so a save does not see a conflict.
      const latest = (await refetch()).data ?? file
      if (!latest) return
      startProjectFileEdit(machineId, {
        cwd,
        path,
        content: latest.content,
        version: latest.version,
      })
    } finally {
      setStarting(false)
    }
  }

  /** End edit mode. Ask first when there are unsaved changes. */
  const endEdit = () => {
    const current = getProjectFileEdit(machineId, cwd, path)
    if (
      isProjectFileEditDirty(current) &&
      !window.confirm(
        `Discard your unsaved changes to ${fileNameFromPath(path)}?`
      )
    )
      return
    endProjectFileEdit(machineId, cwd, path)
  }

  /** Save the draft. With `overwrite`, replace changes on disk. */
  const save = async ({ overwrite = false }: { overwrite?: boolean } = {}) => {
    const current = getProjectFileEdit(machineId, cwd, path)
    if (!current || savingRef.current) return
    if (!overwrite && !isProjectFileEditDirty(current)) return
    const content = current.draft
    savingRef.current = true
    setSaving(true)
    try {
      const result = await fetchJson<ProjectFileWriteData>(
        buildRequestUrl("/api/files/write", {
          machineId,
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd,
            path,
            content,
            version: overwrite ? undefined : current.baseVersion,
          }),
        }
      )
      // The user can type during the save, so keep the draft as it is now.
      rebaseProjectFileEdit(
        machineId,
        { cwd, path, content, version: result.version },
        false
      )
      queryClient.setQueryData<ProjectFileReadData>(
        picoQueryKeys.projectFileRead(viewerContextId, cwd, path),
        (old) => (old ? { ...old, content, version: result.version } : old)
      )
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save the file"))
      // A conflict shows after the refetch, with a choice to reload or
      // overwrite.
      void refetch()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  /** Replace the draft with the file on disk. */
  const reload = () => {
    if (!file) return
    rebaseProjectFileEdit(
      machineId,
      { cwd, path, content: file.content, version: file.version },
      true
    )
  }

  const setDraft = (draft: string) => {
    setProjectFileDraft(machineId, cwd, path, draft)
  }

  return {
    edit,
    dirty,
    diskChanged,
    starting,
    saving,
    startEdit,
    endEdit,
    save,
    reload,
    setDraft,
  }
}
