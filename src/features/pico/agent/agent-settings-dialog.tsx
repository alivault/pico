import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { usePicoEvent } from "@/features/pico/agent/events"
import {
  disablePush,
  enablePush,
  pushEnabled,
  pushSupported,
} from "@/features/pico/agent/push"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"

export type AgentSettings = {
  notifyRunDone: boolean
  notifyNeedsInput: boolean
  ntfyUrl: string
  publicUrl: string
  lspAfterEdit: boolean
  browserHeadless: boolean
  scratchSpillKb: number
  maxChildSessions: number
  maxSpawnDepth: number
  previewPorts: string
  worktreeCopy: Array<string>
}

/** Extra sections, such as tool profiles and MCP, that other modules add. */
type ExtraSection = {
  key: string
  order: number
  Component: React.ComponentType<{ viewerContextId: string }>
}
const extraSections = new Map<string, ExtraSection>()

export function registerAgentSettingsSection(section: ExtraSection) {
  extraSections.set(section.key, section)
}

function Row({
  children,
  description,
  label,
}: {
  children: React.ReactNode
  description?: string
  label: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function SettingsSection({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="space-y-1">
      <h3 className="pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y">{children}</div>
    </section>
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="size-4"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

/** A text or number field that saves when it loses focus or on Enter. */
function Field({
  initial,
  onSave,
  placeholder,
  type = "text",
  width = "w-56",
}: {
  initial: string
  onSave: (value: string) => void
  placeholder?: string
  type?: "text" | "number"
  width?: string
}) {
  const [value, setValue] = React.useState(initial)
  React.useEffect(() => setValue(initial), [initial])
  const save = () => {
    if (value !== initial) onSave(value)
  }
  return (
    <Input
      className={`h-7 ${width} text-xs`}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save()
      }}
    />
  )
}

function DevicePushRow({ viewerContextId }: { viewerContextId: string }) {
  const status = useQuery({
    queryKey: ["pico", "push-enabled", viewerContextId],
    queryFn: () => pushEnabled(viewerContextId),
  })
  const [busy, setBusy] = React.useState(false)
  const run = (work: () => Promise<unknown>, success: string) => {
    setBusy(true)
    void work()
      .then(() => {
        toast.success(success)
        return status.refetch()
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setBusy(false))
  }
  const supported = pushSupported()
  return (
    <Row
      label="Push notifications on this device"
      description={
        supported
          ? "Get a notification when a run finishes or the agent asks a question, also when Pico is closed."
          : "Needs HTTPS (for example Tailscale Serve) or localhost. On iOS, add Pico to the home screen first."
      }
    >
      {busy || status.isPending ? <Spinner size="xs" /> : null}
      {status.data ? (
        <>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  fetchJson(
                    buildRequestUrl("/api/push/test", {
                      contextId: viewerContextId,
                    }),
                    { method: "POST" }
                  ),
                "Sent a test notification"
              )
            }
          >
            Test
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() => disablePush(viewerContextId), "Notifications are off")
            }
          >
            Turn off
          </Button>
        </>
      ) : (
        <Button
          size="xs"
          disabled={busy || !supported}
          onClick={() =>
            run(() => enablePush(viewerContextId), "Notifications are on")
          }
        >
          Turn on
        </Button>
      )}
    </Row>
  )
}

export function AgentSettingsDialog({
  onOpenChange,
  open,
  viewerContextId,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ["pico", "agent-settings", viewerContextId]
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<AgentSettings & { ok: true }>(
        buildRequestUrl("/api/settings/agent", { contextId: viewerContextId })
      ),
    enabled: open,
  })
  const mutation = useMutation({
    mutationFn: (change: Partial<AgentSettings>) =>
      fetchJson<AgentSettings & { ok: true }>(
        buildRequestUrl("/api/settings/agent", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(change),
        }
      ),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onError: (error) => toast.error(errorText(error)),
  })
  const settings = query.data
  const save = (change: Partial<AgentSettings>) => mutation.mutate(change)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Notifications, child sessions, and tools. Tools run without
            approval.
          </DialogDescription>
        </DialogHeader>
        {!settings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="xs" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <SettingsSection title="Notifications">
              <DevicePushRow viewerContextId={viewerContextId} />
              <Row label="When a run finishes">
                <Toggle
                  checked={settings.notifyRunDone}
                  onChange={(value) => save({ notifyRunDone: value })}
                />
              </Row>
              <Row label="When the agent asks a question">
                <Toggle
                  checked={settings.notifyNeedsInput}
                  onChange={(value) => save({ notifyNeedsInput: value })}
                />
              </Row>
              <Row
                label="ntfy topic URL"
                description="Also send notifications to an ntfy topic, for example https://ntfy.sh/my-topic."
              >
                <Field
                  initial={settings.ntfyUrl}
                  placeholder="https://ntfy.sh/…"
                  onSave={(value) => save({ ntfyUrl: value })}
                />
              </Row>
              <Row
                label="Pico address for links"
                description="Notifications open this address, for example your Tailscale URL."
              >
                <Field
                  initial={settings.publicUrl}
                  placeholder="https://…"
                  onSave={(value) => save({ publicUrl: value })}
                />
              </Row>
            </SettingsSection>

            <SettingsSection title="Child sessions">
              <Row label="Running children for each session">
                <Field
                  type="number"
                  width="w-20"
                  initial={String(settings.maxChildSessions)}
                  onSave={(value) => save({ maxChildSessions: Number(value) })}
                />
              </Row>
              <Row label="Levels of nesting">
                <Field
                  type="number"
                  width="w-20"
                  initial={String(settings.maxSpawnDepth)}
                  onSave={(value) => save({ maxSpawnDepth: Number(value) })}
                />
              </Row>
              <Row
                label="Files to copy into new worktrees"
                description="Files that git ignores, as patterns, separated by commas."
              >
                <Field
                  initial={settings.worktreeCopy.join(", ")}
                  onSave={(value) =>
                    save({
                      worktreeCopy: value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Row>
            </SettingsSection>

            <SettingsSection title="Tools">
              <Row
                label="Move large tool output to the scratchpad"
                description="Output larger than this many KB goes to the scratchpad; the agent sees the start. 0 is off."
              >
                <Field
                  type="number"
                  width="w-20"
                  initial={String(settings.scratchSpillKb)}
                  onSave={(value) => save({ scratchSpillKb: Number(value) })}
                />
              </Row>
              <Row
                label="Report type errors after edits"
                description="Add language server errors to the results of edit and write."
              >
                <Toggle
                  checked={settings.lspAfterEdit}
                  onChange={(value) => save({ lspAfterEdit: value })}
                />
              </Row>
              <Row
                label="Browser without a window"
                description="Turn off to watch the agent's browser on the server's screen."
              >
                <Toggle
                  checked={settings.browserHeadless}
                  onChange={(value) => save({ browserHeadless: value })}
                />
              </Row>
              <Row
                label="Preview ports"
                description="Ports for app previews, as start-end."
              >
                <Field
                  width="w-28"
                  initial={settings.previewPorts}
                  onSave={(value) => save({ previewPorts: value })}
                />
              </Row>
            </SettingsSection>

            {[...extraSections.values()]
              .sort((left, right) => left.order - right.order)
              .map((section) => (
                <section.Component
                  key={section.key}
                  viewerContextId={viewerContextId}
                />
              ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Mounted once in the app shell; opens on the `pico:open-agent-settings` event. */
export function AgentSettingsDialogController({
  viewerContextId,
}: {
  viewerContextId: string
}) {
  const [open, setOpen] = React.useState(false)
  usePicoEvent("pico:open-agent-settings", () => setOpen(true))
  if (!open) return null
  return (
    <AgentSettingsDialog
      open={open}
      onOpenChange={setOpen}
      viewerContextId={viewerContextId}
    />
  )
}
