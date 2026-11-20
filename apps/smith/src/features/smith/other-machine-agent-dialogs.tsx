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
import {
  agentTitle,
  archivedAgentsMessage,
  restoredAgentsMessage,
} from "@/features/pico/archive-agents"
import { viewerContextIdForSummaries } from "@/features/pico/machine-store"
import type { AgentListEntry } from "@/lib/pico/api"
import { settle } from "@/lib/settle"

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
    const settled = await settle(
      postToMachine(machineId, "/api/agent/rename", {
        path: entry.path,
        name: nextName,
      })
    )
    setSaving(false)
    if (!settled.ok) {
      const error = settled.error
      toast.error(`Failed to rename the agent: ${errorText(error)}`)
      return
    }
    onOpenChange(false)
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

/** Archive an agent of another machine at once, with Undo in the toast. */
export async function archiveOtherMachineAgent(
  machineId: string,
  entry: AgentListEntry
) {
  if (!entry.path) return false
  const path = entry.path
  const settled = await settle(
    postToMachine(machineId, "/api/agents/delete", { paths: [path] })
  )
  if (!settled.ok) {
    toast.error(`Failed to archive the agent: ${errorText(settled.error)}`)
    return false
  }
  toast.success(archivedAgentsMessage([entry]), {
    action: {
      label: "Undo",
      onClick: () => {
        void (async () => {
          const restored = await settle(
            postToMachine(machineId, "/api/agent/restore", { path })
          )
          if (!restored.ok) {
            toast.error(
              `Failed to restore the agent: ${errorText(restored.error)}`
            )
            return
          }
          toast.success(restoredAgentsMessage([entry]))
        })()
      },
    },
  })
  return true
}

/**
 * Asks before archiving an agent of another machine whose subagents still
 * work: an archived agent does not get their reports.
 */
export function OtherMachineArchiveDialog({
  machineId,
  machineLabel,
  entry,
  subagents,
  onOpenChange,
}: {
  machineId: string
  machineLabel: string
  /** The agent to archive; the dialog is open while it is set. */
  entry: AgentListEntry | undefined
  /** The working subagents of the agent. */
  subagents: Array<AgentListEntry>
  onOpenChange: (open: boolean) => void
}) {
  const [archiving, setArchiving] = React.useState(false)

  const archive = async () => {
    if (!entry || archiving) return
    setArchiving(true)
    const archived = await archiveOtherMachineAgent(machineId, entry)
    setArchiving(false)
    if (archived) onOpenChange(false)
  }

  return (
    <AlertDialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive agent?</AlertDialogTitle>
          <AlertDialogDescription>
            Archive “{entry?.title}” on {machineLabel}.{" "}
            {subagents.length === 1
              ? `Subagent "${agentTitle(subagents[0]!)}" still works.`
              : `${subagents.length} subagents still work.`}{" "}
            An archived agent does not get the reports of its subagents, and a
            restore does not bring them back.
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
