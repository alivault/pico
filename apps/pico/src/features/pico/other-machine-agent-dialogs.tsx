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
import type { AgentListEntry } from "@/lib/pico/api"

/**
 * Rename and archive for the agents of another machine in the sidebar.
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
  /** The agent to rename; the dialog is open while it is set. */
  entry: AgentListEntry | undefined
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
      await postToMachine(machineId, "/api/agent/rename", {
        path: entry.path,
        name: nextName,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to rename the agent: ${errorText(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename agent</DialogTitle>
          <DialogDescription>
            Update the name of this agent on {machineLabel}.
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
            aria-label="Agent name"
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
  /** The agent to archive; the dialog is open while it is set. */
  entry: AgentListEntry | undefined
  onOpenChange: (open: boolean) => void
}) {
  const [archiving, setArchiving] = React.useState(false)

  const archive = async () => {
    if (!entry?.path || archiving) return
    setArchiving(true)
    try {
      await postToMachine(machineId, "/api/agents/delete", {
        paths: [entry.path],
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to archive the agent: ${errorText(error)}`)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <AlertDialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive agent?</AlertDialogTitle>
          <AlertDialogDescription>
            Archive “{entry?.title}” on {machineLabel}. Its history is kept, and
            you can restore it from Archived agents on that machine.
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
