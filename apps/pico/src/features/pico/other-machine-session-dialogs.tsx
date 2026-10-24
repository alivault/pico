import * as React from "react"
import { toast } from "@/lib/pico/toast"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { viewerContextIdForSummaries } from "@/features/pico/machine-store"
import type { SessionListEntry } from "@/lib/pico/api"

/**
 * Rename and archive for the sessions of another machine in the sidebar.
 * The requests go to that machine. The hub then sends a new summary of the
 * machine, which updates its sidebar group.
 */

async function postToMachine(
  machineId: string,
  path: string,
  body: Record<string, unknown>
) {
  await fetchJson(
    buildRequestUrl(path, {
      machineId,
      contextId: viewerContextIdForSummaries(),
    }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  )
}

export function OtherMachineRenameDialog({
  machineId,
  machineLabel,
  entry,
  onOpenChange,
}: {
  machineId: string
  machineLabel: string
  /** The session to rename; the dialog is open while it is set. */
  entry: SessionListEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [lastEntry, setLastEntry] = React.useState(entry)
  if (entry !== lastEntry) {
    setLastEntry(entry)
    if (entry) setName(entry.title)
  }

  const save = async () => {
    const nextName = name.trim()
    if (!entry?.path || !nextName || saving) return
    setSaving(true)
    try {
      await postToMachine(machineId, "/api/session/rename", {
        path: entry.path,
        name: nextName,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to rename the session: ${errorText(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            Update the name of this session on {machineLabel}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            aria-label="Session name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OtherMachineArchiveDialog({
  machineId,
  machineLabel,
  entry,
  onOpenChange,
}: {
  machineId: string
  machineLabel: string
  /** The session to archive; the dialog is open while it is set. */
  entry: SessionListEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const [archiving, setArchiving] = React.useState(false)

  const archive = async () => {
    if (!entry?.path || archiving) return
    setArchiving(true)
    try {
      await postToMachine(machineId, "/api/sessions/delete", {
        paths: [entry.path],
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to archive the session: ${errorText(error)}`)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <AlertDialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive session?</AlertDialogTitle>
          <AlertDialogDescription>
            Archive “{entry?.title}” on {machineLabel}. Its history is kept, and
            you can restore it from Archived sessions on that machine.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={archiving}
            onClick={() => void archive()}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
