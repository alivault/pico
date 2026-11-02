/**
 * The agent settings of a machine, as pages of the settings dialog:
 * notifications, context and subagents, and tools.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import {
  browserLabel,
  currentPushEndpoint,
  disablePush,
  enablePush,
  listPushDevices,
  pushEnabled,
  pushSupported,
  removePushDevice,
} from "@/features/pico/agent/push"
import { errorText } from "@/features/pico/agent/shared"
import {
  buildHubRequestUrl,
  buildRequestUrl,
  fetchJson,
} from "@/features/pico/app-shell-utils"
import {
  registerSettingsPage,
  SettingsEditPage,
  SettingsListPage,
  useCloseSettingsPage,
  useOpenSettingsPage,
  type SettingsPageProps,
} from "@/features/pico/settings-pages"
import { useMachineId } from "@/lib/pico/machine-context"

export type AgentSettings = {
  notifyTurnDone: boolean
  notifyNeedsInput: boolean
  ntfyUrl: string
  publicUrl: string
  browserHeadless: boolean
  scratchSpillKb: number
  maxSubagents: number
  maxSubagentDepth: number
  worktreeCopy: Array<string>
  jobMemoryHigh: string
  jobMemoryMax: string
  compactAtTokens: number
}

/** "200k" or "1.5M" as tokens; empty is 0. Undefined when it is not a count. */
function parseTokenCount(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(value.trim())
  if (!value.trim()) return 0
  if (!match) return undefined
  const unit = match[2]?.toLowerCase()
  const factor = unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1
  return Math.round(Number(match[1]) * factor)
}

function formatTokenCount(value: number) {
  if (value <= 0) return ""
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value % 1_000 === 0) return `${value / 1_000}k`
  return String(value)
}

function useAgentSettings(viewerContextId: string) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const queryKey = ["pico", "agent-settings", machineId, viewerContextId]
  const url = buildRequestUrl("/api/settings/agent", {
    machineId,
    contextId: viewerContextId,
  })
  const query = useQuery({
    queryKey,
    queryFn: () => fetchJson<AgentSettings & { ok: true }>(url),
  })
  const mutation = useMutation({
    mutationFn: (change: Partial<AgentSettings>) =>
      fetchJson<AgentSettings & { ok: true }>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  })
  return {
    settings: query.data,
    save: (change: Partial<AgentSettings>) =>
      mutation.mutate(change, {
        onError: (error) => toast.error(errorText(error)),
      }),
    saveAsync: (change: Partial<AgentSettings>) => mutation.mutateAsync(change),
  }
}

/** A setting that the edit page changes. */
type TextField = {
  title: string
  description: string
  placeholder?: string
  numeric?: boolean
  format: (settings: AgentSettings) => string
  /** The change to save, or an error text. */
  parse: (value: string) => Partial<AgentSettings> | string
}

function wholeNumber(
  value: string,
  key: "maxSubagents" | "maxSubagentDepth" | "scratchSpillKb",
  min: number
) {
  const number = Number(value.trim())
  if (!value.trim() || !Number.isInteger(number) || number < min)
    return `Type a whole number of ${min} or more.`
  return { [key]: number }
}

const TEXT_FIELDS: Record<string, TextField> = {
  ntfyUrl: {
    title: "ntfy topic URL",
    description:
      "Also send notifications to an ntfy topic. Leave empty to send none.",
    placeholder: "https://ntfy.sh/my-topic",
    format: (settings) => settings.ntfyUrl,
    parse: (value) => ({ ntfyUrl: value.trim() }),
  },
  publicUrl: {
    title: "Pico address for links",
    description:
      "A notification opens this address, for example your Tailscale URL.",
    placeholder: "https://…",
    format: (settings) => settings.publicUrl,
    parse: (value) => ({ publicUrl: value.trim() }),
  },
  compactAtTokens: {
    title: "Compact at",
    description:
      "Summarize old messages when the context of an agent gets to this many tokens, for example 200k. A summary starts in the background about 33k before. Leave empty to compact near the full context window.",
    placeholder: "Full context window",
    format: (settings) => formatTokenCount(settings.compactAtTokens),
    parse: (value) => {
      const tokens = parseTokenCount(value)
      return tokens === undefined
        ? "Type a token count, for example 200k."
        : { compactAtTokens: tokens }
    },
  },
  maxSubagents: {
    title: "Subagents at the same time",
    description: "How many subagents can run at the same time.",
    numeric: true,
    format: (settings) => String(settings.maxSubagents),
    parse: (value) => wholeNumber(value, "maxSubagents", 1),
  },
  maxSubagentDepth: {
    title: "Subagent depth",
    description: "How many levels of subagents can start subagents.",
    numeric: true,
    format: (settings) => String(settings.maxSubagentDepth),
    parse: (value) => wholeNumber(value, "maxSubagentDepth", 1),
  },
  worktreeCopy: {
    title: "Files to copy into new worktrees",
    description:
      "Files that git ignores, such as .env, as patterns. Use commas between them.",
    placeholder: ".env, .env.local",
    format: (settings) => settings.worktreeCopy.join(", "),
    parse: (value) => ({
      worktreeCopy: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    }),
  },
  scratchSpillKb: {
    title: "Large tool output",
    description:
      "Tool output larger than this many KB goes to a file in the scratchpad. The agent sees the start and reads the rest. 0 is off.",
    numeric: true,
    format: (settings) => String(settings.scratchSpillKb),
    parse: (value) => wholeNumber(value, "scratchSpillKb", 0),
  },
  jobMemoryHigh: {
    title: "Job memory soft limit",
    description:
      'MemoryHigh of the systemd scope of each background job, on Linux. Leave empty for 60% of the memory. Type "off", or a size such as 8G or 50%.',
    placeholder: "60%",
    format: (settings) => settings.jobMemoryHigh,
    parse: (value) => ({ jobMemoryHigh: value.trim() }),
  },
  jobMemoryMax: {
    title: "Job memory hard limit",
    description:
      'MemoryMax of the systemd scope of each background job, on Linux. Leave empty for 85% of the memory. Type "off", or a size such as 12G or 90%.',
    placeholder: "85%",
    format: (settings) => settings.jobMemoryMax,
    parse: (value) => ({ jobMemoryMax: value.trim() }),
  },
}

type TextFieldKey = keyof typeof TEXT_FIELDS

/** A settings item that shows a text setting and opens its edit page. */
function useTextItem(settings: AgentSettings | undefined) {
  const open = useOpenSettingsPage()
  return (key: TextFieldKey, empty = "Not set") => {
    const field = TEXT_FIELDS[key]!
    const value = settings ? field.format(settings) : ""
    return {
      id: key,
      title: field.title,
      value: value || empty,
      submenu: true,
      keywords: [field.description],
      onSelect: () => open({ key: "agent-edit", params: { field: key } }),
    }
  }
}

function EditFieldPage({ viewerContextId, params }: SettingsPageProps) {
  const { settings, saveAsync } = useAgentSettings(viewerContextId)
  const field = TEXT_FIELDS[params.field ?? ""]
  if (!field || !settings) return null
  return (
    <SettingsEditPage
      title={field.title}
      description={field.description}
      initial={field.format(settings)}
      placeholder={field.placeholder}
      inputMode={field.numeric ? "numeric" : undefined}
      onSave={async (value) => {
        const change = field.parse(value)
        if (typeof change === "string") return change
        try {
          await saveAsync(change)
          return undefined
        } catch (error) {
          return errorText(error)
        }
      }}
    />
  )
}

function usePushState(viewerContextId: string) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ["pico", "push-enabled", viewerContextId],
    queryFn: () => pushEnabled(viewerContextId),
  })
  const devices = useQuery({
    queryKey: ["pico", "push-devices", viewerContextId],
    queryFn: async () => ({
      devices: await listPushDevices(viewerContextId),
      current: await currentPushEndpoint(),
    }),
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["pico", "push-enabled", viewerContextId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["pico", "push-devices", viewerContextId],
      }),
    ])
  return { status, devices, refresh }
}

/** A short name for a device. Older entries keep the user agent as label. */
function deviceLabel(label: string | undefined) {
  if (!label) return "Unknown browser"
  return label.startsWith("Mozilla/") ? browserLabel(label) : label
}

function NotificationsPage({ viewerContextId }: SettingsPageProps) {
  const open = useOpenSettingsPage()
  const { settings, save } = useAgentSettings(viewerContextId)
  const textItem = useTextItem(settings)
  const { status, devices, refresh } = usePushState(viewerContextId)
  const [busy, setBusy] = React.useState<"push" | "test">()
  const supported = pushSupported()
  const enabled = Boolean(status.data)
  const deviceCount = devices.data?.devices.length ?? 0

  const run = (
    kind: "push" | "test",
    work: () => Promise<unknown>,
    success: string
  ) => {
    if (busy) return
    setBusy(kind)
    void work()
      .then(() => {
        toast.success(success)
        return refresh()
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setBusy(undefined))
  }

  return (
    <SettingsListPage
      title="Notifications"
      subtitle="Tell you when an agent stops, also when Pico is closed."
      loading={!settings}
      groups={
        settings
          ? [
              {
                heading: "This device",
                items: [
                  {
                    id: "push",
                    title: "Push notifications",
                    description: supported
                      ? "Show notifications on this device."
                      : "Needs HTTPS (for example Tailscale Serve) or localhost. On iOS, add Pico to the home screen first.",
                    checked: enabled,
                    disabled: !supported || status.isPending,
                    busy: busy === "push",
                    onSelect: () =>
                      enabled
                        ? run(
                            "push",
                            () => disablePush(viewerContextId),
                            "Push notifications are off"
                          )
                        : run(
                            "push",
                            () => enablePush(viewerContextId),
                            "Push notifications are on"
                          ),
                  },
                  ...(enabled
                    ? [
                        {
                          id: "test",
                          title: "Send a test notification",
                          busy: busy === "test",
                          onSelect: () =>
                            run(
                              "test",
                              () =>
                                fetchJson(
                                  buildHubRequestUrl("/api/push/test", {
                                    contextId: viewerContextId,
                                  }),
                                  { method: "POST" }
                                ),
                              "Sent a test notification"
                            ),
                        },
                      ]
                    : []),
                  {
                    id: "devices",
                    title: "Devices",
                    description: "The browsers that get push notifications.",
                    value: String(deviceCount),
                    submenu: true,
                    onSelect: () => open({ key: "agent-push-devices" }),
                  },
                ],
              },
              {
                heading: "Notify when",
                items: [
                  {
                    id: "turn-done",
                    title: "An agent finishes its turn",
                    checked: settings.notifyTurnDone,
                    onSelect: () =>
                      save({ notifyTurnDone: !settings.notifyTurnDone }),
                  },
                  {
                    id: "needs-input",
                    title: "An agent asks a question",
                    checked: settings.notifyNeedsInput,
                    onSelect: () =>
                      save({ notifyNeedsInput: !settings.notifyNeedsInput }),
                  },
                ],
              },
              {
                heading: "Delivery",
                items: [textItem("ntfyUrl", "Off"), textItem("publicUrl")],
              },
            ]
          : []
      }
    />
  )
}

function PushDevicesPage({ viewerContextId }: SettingsPageProps) {
  const open = useOpenSettingsPage()
  const { devices } = usePushState(viewerContextId)
  const list = devices.data?.devices ?? []
  return (
    <SettingsListPage
      title="Devices"
      subtitle="Select a device to stop its notifications."
      loading={devices.isPending}
      emptyText="No devices get push notifications."
      groups={[
        {
          items: list.map((device) => {
            const current = device.endpoint === devices.data?.current
            return {
              id: device.endpoint,
              title: deviceLabel(device.label),
              description: [
                device.origin,
                `Added ${new Date(device.addedAt).toLocaleDateString()}`,
              ]
                .filter(Boolean)
                .join(" · "),
              value: current ? "This browser" : undefined,
              submenu: true,
              onSelect: () =>
                open({
                  key: "agent-push-device",
                  params: { endpoint: device.endpoint },
                }),
            }
          }),
        },
      ]}
    />
  )
}

function PushDevicePage({ viewerContextId, params }: SettingsPageProps) {
  const close = useCloseSettingsPage()
  const { devices, refresh } = usePushState(viewerContextId)
  const [busy, setBusy] = React.useState(false)
  const device = devices.data?.devices.find(
    (item) => item.endpoint === params.endpoint
  )
  const label = deviceLabel(device?.label)
  return (
    <SettingsListPage
      title={label}
      subtitle={device?.origin}
      loading={devices.isPending}
      groups={[
        {
          items: [
            {
              id: "remove",
              title: "Remove device",
              description: "This device gets no more push notifications.",
              destructive: true,
              busy,
              disabled: !device || busy,
              onSelect: () => {
                if (!device) return
                setBusy(true)
                void removePushDevice(viewerContextId, device.endpoint)
                  .then(() => refresh())
                  .then(() => {
                    toast.success(`Removed ${label}`)
                    close()
                  })
                  .catch((error: unknown) => toast.error(errorText(error)))
                  .finally(() => setBusy(false))
              },
            },
            { id: "cancel", title: "Cancel", onSelect: close },
          ],
        },
      ]}
    />
  )
}

function ContextPage({ viewerContextId }: SettingsPageProps) {
  const { settings } = useAgentSettings(viewerContextId)
  const textItem = useTextItem(settings)
  return (
    <SettingsListPage
      title="Context and subagents"
      subtitle="When to compact, and how subagents run."
      loading={!settings}
      groups={[
        { heading: "Context", items: [textItem("compactAtTokens", "Auto")] },
        {
          heading: "Subagents",
          items: [
            textItem("maxSubagents"),
            textItem("maxSubagentDepth"),
            textItem("worktreeCopy", "None"),
          ],
        },
      ]}
    />
  )
}

function ToolsPage({ viewerContextId }: SettingsPageProps) {
  const { settings, save } = useAgentSettings(viewerContextId)
  const textItem = useTextItem(settings)
  return (
    <SettingsListPage
      title="Tools"
      subtitle="Tools run without approval."
      loading={!settings}
      groups={
        settings
          ? [
              {
                heading: "Output",
                items: [
                  {
                    ...textItem("scratchSpillKb"),
                    value:
                      settings.scratchSpillKb > 0
                        ? `${settings.scratchSpillKb} KB`
                        : "Off",
                  },
                ],
              },
              {
                heading: "Browser",
                items: [
                  {
                    id: "browser-headless",
                    title: "Browser without a window",
                    description:
                      "Turn off to watch the browser of the agent on the screen of the server.",
                    checked: settings.browserHeadless,
                    onSelect: () =>
                      save({ browserHeadless: !settings.browserHeadless }),
                  },
                ],
              },
              {
                heading: "Background jobs",
                items: [
                  textItem("jobMemoryHigh", "60%"),
                  textItem("jobMemoryMax", "85%"),
                ],
              },
            ]
          : []
      }
    />
  )
}

registerSettingsPage({
  key: "agent-notifications",
  Component: NotificationsPage,
  entry: {
    group: "Agent",
    title: "Notifications",
    description: "Push notifications and ntfy, when an agent stops.",
    keywords: [
      "push",
      "notifications",
      "ntfy",
      "devices",
      "turn",
      "question",
      "address",
      "tailscale",
    ],
    order: 10,
  },
})
registerSettingsPage({ key: "agent-push-devices", Component: PushDevicesPage })
registerSettingsPage({ key: "agent-push-device", Component: PushDevicePage })
registerSettingsPage({
  key: "agent-context",
  Component: ContextPage,
  entry: {
    group: "Agent",
    title: "Context and subagents",
    description: "When to compact, subagent limits, and worktree files.",
    keywords: [
      "context",
      "compact",
      "compaction",
      "tokens",
      "subagents",
      "depth",
      "worktree",
      "copy",
    ],
    order: 20,
  },
})
registerSettingsPage({
  key: "agent-tools",
  Component: ToolsPage,
  entry: {
    group: "Agent",
    title: "Tools",
    description: "Large tool output, the agent browser, and job memory.",
    keywords: [
      "tools",
      "scratchpad",
      "output",
      "browser",
      "headless",
      "jobs",
      "memory",
      "systemd",
    ],
    order: 30,
  },
})
registerSettingsPage({ key: "agent-edit", Component: EditFieldPage })
