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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { usePicoEvent } from "@/features/pico/agent/events"
import {
  disablePush,
  enablePush,
  pushEnabled,
  pushSupported,
} from "@/features/pico/agent/push"
import { errorText } from "@/features/pico/agent/shared"
import {
  buildHubRequestUrl,
  buildRequestUrl,
  fetchJson,
} from "@/features/pico/app-shell-utils"
import { MachineFeatureGate } from "@/features/pico/machine-store"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

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

/** Extra sections, such as MCP, that other modules add. */
type ExtraSection = {
  key: string
  order: number
  /** Show the section only when the server has this feature. */
  feature?: string
  Component: React.ComponentType<{ viewerContextId: string }>
}
const extraSections = new Map<string, ExtraSection>()

export function registerAgentSettingsSection(section: ExtraSection) {
  extraSections.set(section.key, section)
}

let rowCounter = 0

/** One setting: a label and description on the left, its control on the right. */
function Row({
  children,
  description,
  label,
  control,
  stacked = false,
}: {
  children?: React.ReactNode
  description?: string
  label: string
  /** Render the control with the id that labels it. */
  control?: (id: string) => React.ReactNode
  /** Put the control under the label, for text fields. */
  stacked?: boolean
}) {
  const [id] = React.useState(() => `agent-setting-${++rowCounter}`)
  if (stacked)
    return (
      <Field className="gap-1.5 py-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
        {control?.(id)}
      </Field>
    )
  return (
    <Field
      orientation="horizontal"
      className={cn(
        "gap-4 py-3",
        !description && "has-[>[data-slot=field-content]]:items-center"
      )}
    >
      <FieldContent className="min-w-0">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </FieldContent>
      <div className="flex shrink-0 items-center gap-2">
        {control?.(id)}
        {children}
      </div>
    </Field>
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
      <h3 className="pt-3 text-sm font-semibold">{title}</h3>
      <div className="divide-y rounded-lg border px-3">{children}</div>
    </section>
  )
}

/** A text or number field that saves when it loses focus or on Return. */
function TextSetting({
  id,
  initial,
  onSave,
  placeholder,
  type = "text",
  width = "w-full",
}: {
  id: string
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
      id={id}
      className={`h-8 ${width}`}
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
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  fetchJson(
                    buildHubRequestUrl("/api/push/test", {
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
            size="sm"
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
          size="sm"
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
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const queryKey = ["pico", "agent-settings", viewerContextId]
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<AgentSettings & { ok: true }>(
        buildRequestUrl("/api/settings/agent", {
          machineId,
          contextId: viewerContextId,
        })
      ),
    enabled: open,
  })
  const mutation = useMutation({
    mutationFn: (change: Partial<AgentSettings>) =>
      fetchJson<AgentSettings & { ok: true }>(
        buildRequestUrl("/api/settings/agent", {
          machineId,
          contextId: viewerContextId,
        }),
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
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
              <Row
                label="Notify when a run finishes"
                control={(id) => (
                  <Switch
                    id={id}
                    checked={settings.notifyRunDone}
                    onCheckedChange={(value) => save({ notifyRunDone: value })}
                  />
                )}
              />
              <Row
                label="Notify when the agent asks a question"
                control={(id) => (
                  <Switch
                    id={id}
                    checked={settings.notifyNeedsInput}
                    onCheckedChange={(value) =>
                      save({ notifyNeedsInput: value })
                    }
                  />
                )}
              />
              <Row
                stacked
                label="ntfy topic URL"
                description="Also send notifications to an ntfy topic, for example https://ntfy.sh/my-topic."
                control={(id) => (
                  <TextSetting
                    id={id}
                    initial={settings.ntfyUrl}
                    placeholder="https://ntfy.sh/…"
                    onSave={(value) => save({ ntfyUrl: value })}
                  />
                )}
              />
              <Row
                stacked
                label="Pico address for links"
                description="Notifications open this address, for example your Tailscale URL."
                control={(id) => (
                  <TextSetting
                    id={id}
                    initial={settings.publicUrl}
                    placeholder="https://…"
                    onSave={(value) => save({ publicUrl: value })}
                  />
                )}
              />
            </SettingsSection>

            <SettingsSection title="Child sessions">
              <Row
                label="Child sessions that can run at once"
                control={(id) => (
                  <TextSetting
                    id={id}
                    type="number"
                    width="w-20"
                    initial={String(settings.maxChildSessions)}
                    onSave={(value) =>
                      save({ maxChildSessions: Number(value) })
                    }
                  />
                )}
              />
              <Row
                label="How deep child sessions can nest"
                control={(id) => (
                  <TextSetting
                    id={id}
                    type="number"
                    width="w-20"
                    initial={String(settings.maxSpawnDepth)}
                    onSave={(value) => save({ maxSpawnDepth: Number(value) })}
                  />
                )}
              />
              <Row
                stacked
                label="Files to copy into new worktrees"
                description="Files that git ignores, as patterns, separated by commas."
                control={(id) => (
                  <TextSetting
                    id={id}
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
                )}
              />
            </SettingsSection>

            <SettingsSection title="Tools">
              <Row
                label="Move large tool output to the scratchpad"
                description="Output larger than this many KB goes to the scratchpad; the agent sees the start. 0 is off."
                control={(id) => (
                  <TextSetting
                    id={id}
                    type="number"
                    width="w-20"
                    initial={String(settings.scratchSpillKb)}
                    onSave={(value) => save({ scratchSpillKb: Number(value) })}
                  />
                )}
              />
              <Row
                label="Report type errors after edits"
                description="Add language server errors to the results of edit and write."
                control={(id) => (
                  <Switch
                    id={id}
                    checked={settings.lspAfterEdit}
                    onCheckedChange={(value) => save({ lspAfterEdit: value })}
                  />
                )}
              />
              <Row
                label="Browser without a window"
                description="Turn off to watch the agent's browser on the server's screen."
                control={(id) => (
                  <Switch
                    id={id}
                    checked={settings.browserHeadless}
                    onCheckedChange={(value) =>
                      save({ browserHeadless: value })
                    }
                  />
                )}
              />
              <Row
                label="Preview ports"
                description="Ports for app previews, as start-end."
                control={(id) => (
                  <TextSetting
                    id={id}
                    width="w-28"
                    initial={settings.previewPorts}
                    onSave={(value) => save({ previewPorts: value })}
                  />
                )}
              />
            </SettingsSection>

            {[...extraSections.values()]
              .sort((left, right) => left.order - right.order)
              .map((section) => (
                <MachineFeatureGate key={section.key} feature={section.feature}>
                  <section.Component viewerContextId={viewerContextId} />
                </MachineFeatureGate>
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
