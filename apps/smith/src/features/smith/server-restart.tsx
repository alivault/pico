/**
 * The server of a machine: its version, a newer build on disk, and a
 * restart that loads it. A restart is at once: turns that it cuts off
 * continue after it,
 * and terminals and jobs run on in the pty-host. With the `self-update`
 * feature, the server also finds new releases and installs them.
 */
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import {
  ArrowUpCircleIcon,
  CopyIcon,
  DownloadIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  RotateCwIcon,
} from "lucide-react"

import { SidebarMenuAction, SidebarMenuItem } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { fetchJson } from "@/features/smith/app-shell-utils"
import { copyTextToClipboard } from "@/features/smith/markdown-renderer"
import {
  registerSettingsPage,
  SettingsListPage,
  type SettingsItem,
} from "@/features/smith/settings-pages"
import { useMachineFeatureCheck } from "@/features/smith/machine-store"
import { isRemoteMachine, machineApiUrl } from "@/lib/smith/machine"
import { useMachineId } from "@/lib/smith/machine-context"
import { toast } from "@/lib/smith/toast"

export type ServerHealth = {
  ok: true
  version: string
  pid?: number
  startedAt?: string
  /** Not set when the server cannot restart itself. */
  restart?: object
  update?: { available: boolean; version?: string }
  /** A newer release on the update channel (`self-update`). */
  release?: {
    available: boolean
    installing: boolean
    canInstall?: boolean
    latest?: string
  }
  webBuild?: string
}

/** What `/api/system/update` reports (server/src/services/self-update.ts). */
export type UpdateStatus = {
  current: string
  installed: string
  channel: "stable" | "preview"
  check: boolean
  install: "npm" | "source" | "other"
  latest?: string
  available: boolean
  command?: string
  checkedAt?: string
  checking: boolean
  installing: boolean
  error?: string
}

export const SERVER_RESTART_FEATURE = "server-restart"
export const SELF_UPDATE_FEATURE = "self-update"

const serverHealthKey = (machineId: string) =>
  ["smith", "server-health", machineId] as const

function fetchHealth(machineId: string) {
  return fetchJson<ServerHealth>(machineApiUrl(machineId, "/api/system/health"))
}

/** The health of the machine's server; it checks again each minute. */
export function useServerHealth(machineId: string) {
  const hasFeature = useMachineFeatureCheck()
  const query = useQuery({
    queryKey: serverHealthKey(machineId),
    queryFn: () => fetchHealth(machineId),
    enabled: hasFeature(SERVER_RESTART_FEATURE),
    refetchInterval: 60_000,
    staleTime: 10_000,
  })
  return query.data?.ok ? query.data : undefined
}

/** A short state for the settings list: an update or the version. */
export function serverStatusLabel(health: ServerHealth | undefined) {
  if (!health) return ""
  if (health.update?.available) return "Update ready"
  if (health.release?.installing) return "Updating…"
  if (health.release?.available && health.release.latest)
    return `v${health.release.latest} available`
  return `v${health.version}`
}

/** Wait until a new server process answers, and give its health. */
async function waitForNewServer(machineId: string, before: ServerHealth) {
  const deadline = Date.now() + 2 * 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const response = await fetch(
        machineApiUrl(machineId, "/api/system/health"),
        { cache: "no-store" }
      )
      if (!response.ok) continue
      const health = (await response.json()) as ServerHealth
      if (health.pid !== before.pid || health.startedAt !== before.startedAt)
        return health
    } catch {
      // The server is down for the restart.
    }
  }
  return undefined
}

/** Restart the machine's server at once, and wait until it is back. */
export async function restartServer({
  machineId,
  queryClient,
}: {
  machineId: string
  queryClient: QueryClient
}) {
  const toastId = `server-restart:${machineId}`
  try {
    const before = await fetchHealth(machineId)
    await fetchJson<{ ok: true }>(
      machineApiUrl(machineId, "/api/system/restart"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // An older server waits for active turns without `now`.
        body: JSON.stringify({ now: true }),
      }
    )
    toast.loading("Smith is restarting…", { id: toastId })
    void queryClient.invalidateQueries({ queryKey: serverHealthKey(machineId) })
    const after = await waitForNewServer(machineId, before)
    if (!after) {
      toast.error("Smith did not start again in time", {
        id: toastId,
        description: "Look at the server log.",
      })
      return
    }
    queryClient.setQueryData(serverHealthKey(machineId), after)
    void queryClient.invalidateQueries({ queryKey: updateStatusKey(machineId) })
    const updated = after.version !== before.version
    // This page comes from the local server. Load its new web client too.
    if (
      !isRemoteMachine(machineId) &&
      after.webBuild &&
      after.webBuild !== before.webBuild
    ) {
      // Tell the reloaded page to show what is new.
      if (updated) sessionStorage.setItem(UPDATED_KEY, after.version)
      window.location.reload()
      return
    }
    showRunning(after.version, updated, toastId)
  } catch (error) {
    toast.error("Could not restart Smith", {
      id: toastId,
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

const UPDATED_KEY = "smith:updated-to"

function releaseNotesUrl(version: string) {
  return `https://github.com/alivault/smith/releases/tag/v${version}`
}

/** The toast after a restart; after an update, it links the release notes. */
function showRunning(version: string, updated: boolean, id?: string) {
  toast.success(
    updated ? `Smith is updated to ${version}` : `Smith ${version} is running`,
    {
      ...(id ? { id } : {}),
      description: undefined,
      ...(updated
        ? {
            action: {
              label: "What’s new",
              onClick: () =>
                window.open(releaseNotesUrl(version), "_blank", "noopener"),
            },
          }
        : {}),
    }
  )
}

// A page that an update reloaded shows the toast that the old page could not.
if (typeof window !== "undefined") {
  const version = sessionStorage.getItem(UPDATED_KEY)
  if (version) {
    sessionStorage.removeItem(UPDATED_KEY)
    setTimeout(() => showRunning(version, true), 500)
  }
}

const updateStatusKey = (machineId: string) =>
  ["smith", "server-update", machineId] as const

function updateUrl(machineId: string, path = "") {
  return machineApiUrl(machineId, `/api/system/update${path}`)
}

/** The update state of the machine's server, while a page shows it. */
export function useUpdateStatus(machineId: string) {
  const hasFeature = useMachineFeatureCheck()
  const query = useQuery({
    queryKey: updateStatusKey(machineId),
    queryFn: () => fetchJson<UpdateStatus & { ok: true }>(updateUrl(machineId)),
    enabled: hasFeature(SELF_UPDATE_FEATURE),
    refetchInterval: (current) =>
      current.state.data?.installing || current.state.data?.checking
        ? 1500
        : 60_000,
    staleTime: 5_000,
  })
  return query.data
}

async function postUpdate(
  machineId: string,
  path: string,
  body: Record<string, unknown> = {}
) {
  return fetchJson<UpdateStatus & { ok: true }>(updateUrl(machineId, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

export async function checkForUpdate({
  machineId,
  queryClient,
}: {
  machineId: string
  queryClient: QueryClient
}) {
  const status = await postUpdate(machineId, "/check")
  queryClient.setQueryData(updateStatusKey(machineId), status)
  void queryClient.invalidateQueries({ queryKey: serverHealthKey(machineId) })
  if (status.error) toast.error(status.error)
  else if (!status.available)
    toast.success(`Smith ${status.installed} is up to date`, {
      description: `The newest ${status.channel} version is ${status.latest}.`,
    })
  return status
}

export async function changeUpdateSettings({
  machineId,
  queryClient,
  change,
}: {
  machineId: string
  queryClient: QueryClient
  change: { channel?: UpdateStatus["channel"]; check?: boolean }
}) {
  try {
    const status = await postUpdate(machineId, "/settings", change)
    queryClient.setQueryData(updateStatusKey(machineId), status)
    // A new channel has its own newest version.
    if (change.channel) await checkForUpdate({ machineId, queryClient })
  } catch (error) {
    toast.error("Could not change the update settings", {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Install the newest release, then restart, so the server runs it. */
export async function updateServer({
  machineId,
  queryClient,
}: {
  machineId: string
  queryClient: QueryClient
}) {
  const toastId = `server-restart:${machineId}`
  try {
    let status = await postUpdate(machineId, "/install")
    toast.loading(
      status.latest ? `Installing Smith ${status.latest}…` : "Installing…",
      { id: toastId }
    )
    void queryClient.invalidateQueries({ queryKey: serverHealthKey(machineId) })
    const deadline = Date.now() + 15 * 60_000
    while (status.installing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      status = await fetchJson<UpdateStatus & { ok: true }>(
        updateUrl(machineId)
      )
      queryClient.setQueryData(updateStatusKey(machineId), status)
    }
    if (status.installing) throw new Error("The install takes too long.")
    if (status.error) throw new Error(status.error)
    await restartServer({ machineId, queryClient })
  } catch (error) {
    toast.error("Could not update Smith", {
      id: toastId,
      description: error instanceof Error ? error.message : String(error),
    })
    void queryClient.invalidateQueries({ queryKey: updateStatusKey(machineId) })
  }
}

/**
 * A row in the sidebar footer when a new release is available or installs.
 */
export function ServerUpdateStatus() {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const health = useServerHealth(machineId)
  const release = health?.release
  if (
    !release?.latest ||
    !release.canInstall ||
    !(release.available || release.installing) ||
    health?.update?.available
  )
    return null
  return (
    <SidebarMenuItem>
      <div className="flex h-(--sidebar-item-size) items-center gap-2 rounded-md px-(--sidebar-item-pad) pr-8 text-xs text-muted-foreground">
        {release.installing ? (
          <Spinner size="xs" aria-label="Installing" />
        ) : (
          <ArrowUpCircleIcon className="size-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">
          {release.installing
            ? `Installing Smith ${release.latest}…`
            : `Smith ${release.latest} is available`}
        </span>
      </div>
      {release.installing ? null : (
        <TitleTooltip title="Update and restart">
          <SidebarMenuAction
            aria-label="Update Smith"
            onClick={() => void updateServer({ machineId, queryClient })}
          >
            <DownloadIcon />
          </SidebarMenuAction>
        </TitleTooltip>
      )}
    </SidebarMenuItem>
  )
}

function ServerPage() {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const health = useServerHealth(machineId)
  const canRestart = Boolean(health?.restart)
  const update = useUpdateStatus(machineId)

  const version: SettingsItem = {
    id: "version",
    title: health ? `Smith ${health.version}` : "Smith",
    description: health?.update?.available
      ? health.update.version
        ? `Version ${health.update.version} is installed. A restart runs it.`
        : "A newer build is on disk. A restart runs it."
      : "The server runs the newest build on disk.",
    value: health?.update?.available ? "Update ready" : undefined,
    disabled: true,
  }
  const updateItems = update
    ? updateSettingsItems({ status: update, machineId, queryClient })
    : []
  const items: Array<SettingsItem> = canRestart
    ? [
        {
          id: "restart",
          title: "Restart",
          description:
            "Smith restarts at once. Turns that the restart cuts off continue after it; a running tool call starts again or ends with an error.",
          icon: <RotateCwIcon />,
          onSelect: () => void restartServer({ machineId, queryClient }),
        },
      ]
    : []

  return (
    <SettingsListPage
      title="Server"
      subtitle={
        health?.startedAt
          ? `Running since ${new Date(health.startedAt).toLocaleString()}`
          : undefined
      }
      loading={!health}
      groups={[
        { items: [version, ...items] },
        ...(updateItems.length
          ? [{ heading: "Updates", items: updateItems }]
          : []),
      ]}
      note={
        health && !canRestart
          ? "This server cannot restart itself. Restart it where it runs."
          : "Terminals and jobs continue during a restart."
      }
    />
  )
}

/** The update items of the Server page. */
function updateSettingsItems({
  status,
  machineId,
  queryClient,
}: {
  status: UpdateStatus
  machineId: string
  queryClient: QueryClient
}): Array<SettingsItem> {
  const latest = status.latest
  const items: Array<SettingsItem> = []
  if (status.available && latest && status.install === "npm")
    items.push({
      id: "update",
      title: `Update to Smith ${latest}`,
      description: status.installing
        ? "Installing with npm. Then Smith restarts."
        : "Install it with npm, then restart Smith.",
      keywords: ["update", "upgrade", "install", "new version"],
      icon: <DownloadIcon />,
      busy: status.installing,
      disabled: status.installing,
      onSelect: () => void updateServer({ machineId, queryClient }),
    })
  else if (status.available && latest && status.command) {
    const command = status.command
    items.push({
      id: "update-command",
      title: `Smith ${latest} is available`,
      description: `Smith cannot update this install by itself. Run: ${command}`,
      keywords: ["update", "upgrade", "install", "command"],
      icon: <CopyIcon />,
      value: "Copy command",
      onSelect: () =>
        void copyTextToClipboard(command).then(
          () => toast.success("Copied the update command"),
          () => toast.error("Could not copy the command")
        ),
    })
  }
  items.push(
    {
      id: "update-check",
      title: "Check for updates",
      description:
        status.error ??
        (status.checkedAt
          ? `Last checked ${new Date(status.checkedAt).toLocaleString()}${latest ? `. The newest ${status.channel} version is ${latest}.` : "."}`
          : status.install === "source"
            ? "This Smith runs from a source checkout; update it with git."
            : "Not checked yet."),
      keywords: ["update", "check", "version", "latest"],
      icon: <RefreshCwIcon />,
      busy: status.checking,
      disabled: status.checking || status.installing,
      onSelect: () =>
        void checkForUpdate({ machineId, queryClient }).catch(
          (error: unknown) =>
            toast.error("Could not check for updates", {
              description:
                error instanceof Error ? error.message : String(error),
            })
        ),
    },
    {
      id: "update-preview",
      title: "Preview releases",
      description:
        "Get prereleases (npm tag next) before they become stable releases.",
      keywords: ["channel", "preview", "beta", "prerelease", "next"],
      icon: <FlaskConicalIcon />,
      checked: status.channel === "preview",
      onSelect: () =>
        void changeUpdateSettings({
          machineId,
          queryClient,
          change: {
            channel: status.channel === "preview" ? "stable" : "preview",
          },
        }),
    },
    {
      id: "update-auto-check",
      title: "Check automatically",
      description:
        "Look for a new version every six hours, and show it in the sidebar.",
      keywords: ["update", "automatic", "background", "notify"],
      icon: <ArrowUpCircleIcon />,
      checked: status.check,
      onSelect: () =>
        void changeUpdateSettings({
          machineId,
          queryClient,
          change: { check: !status.check },
        }),
    }
  )
  return items
}

registerSettingsPage({ key: "server", Component: ServerPage })
