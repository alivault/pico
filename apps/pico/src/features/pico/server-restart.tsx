/**
 * The server of a machine: its version, a newer build on disk, and a
 * restart that loads it. Turns that a restart cuts off continue after it,
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
  ZapIcon,
} from "lucide-react"

import { SidebarMenuAction, SidebarMenuItem } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { TitleTooltip } from "@/components/ui/tooltip"
import { fetchJson } from "@/features/pico/app-shell-utils"
import { copyTextToClipboard } from "@/features/pico/markdown-renderer"
import {
  registerSettingsPage,
  SettingsListPage,
  type SettingsItem,
} from "@/features/pico/settings-pages"
import { useMachineFeatureCheck } from "@/features/pico/machine-store"
import { isRemoteMachine, machineApiUrl } from "@/lib/pico/machine"
import { useMachineId } from "@/lib/pico/machine-context"
import { toast } from "@/lib/pico/toast"

export type ServerHealth = {
  ok: true
  version: string
  pid?: number
  startedAt?: string
  phase: "serving" | "draining"
  activeTurnCount: number
  /** Not set when the server cannot restart itself. */
  restart?: { pending: boolean }
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
  ["pico", "server-health", machineId] as const

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
    refetchInterval: (current) =>
      current.state.data?.restart?.pending ? 2000 : 60_000,
    staleTime: 10_000,
  })
  return query.data?.ok ? query.data : undefined
}

/** A short state for the settings list: an update or a restart in progress. */
export function serverStatusLabel(health: ServerHealth | undefined) {
  if (!health) return ""
  if (health.restart?.pending) return "Restarting…"
  if (health.update?.available) return "Update ready"
  if (health.release?.installing) return "Updating…"
  if (health.release?.available && health.release.latest)
    return `v${health.release.latest} available`
  return `v${health.version}`
}

/**
 * Wait until a new server process answers, and give its health. `onDown`
 * runs one time, when the old server stops answering.
 */
async function waitForNewServer(
  machineId: string,
  before: ServerHealth,
  onDown: () => void
) {
  let down = false
  const markDown = () => {
    if (down) return
    down = true
    onDown()
  }
  const deadline = Date.now() + 12 * 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const response = await fetch(
        machineApiUrl(machineId, "/api/system/health"),
        { cache: "no-store" }
      )
      if (!response.ok) {
        markDown()
        continue
      }
      const health = (await response.json()) as ServerHealth
      if (health.pid !== before.pid || health.startedAt !== before.startedAt)
        return health
    } catch {
      // The server is down for the restart.
      markDown()
    }
  }
  return undefined
}

export async function restartServer({
  machineId,
  now,
  queryClient,
}: {
  machineId: string
  now: boolean
  queryClient: QueryClient
}) {
  const toastId = `server-restart:${machineId}`
  try {
    const before = await fetchHealth(machineId)
    const started = await fetchJson<{ ok: true; activeTurnCount: number }>(
      machineApiUrl(machineId, "/api/system/restart"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ now }),
      }
    )
    const showRestarting = () =>
      toast.loading("Pico is restarting…", { id: toastId })
    // While Pico waits for turns, the sidebar shows the restart
    // (`ServerRestartStatus`). The toast only shows when the server stops.
    const turns = now ? 0 : started.activeTurnCount
    if (turns > 0)
      toast.info(`Pico restarts when ${turnsText(turns)} finish`, {
        id: toastId,
        description: "The sidebar shows the restart until then.",
      })
    else showRestarting()
    void queryClient.invalidateQueries({ queryKey: serverHealthKey(machineId) })
    const after = await waitForNewServer(machineId, before, () => {
      if (turns > 0) showRestarting()
    })
    if (!after) {
      toast.error("Pico did not start again in time", {
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
    toast.error("Could not restart Pico", {
      id: toastId,
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

const UPDATED_KEY = "pico:updated-to"

function releaseNotesUrl(version: string) {
  return `https://github.com/alivault/pico/releases/tag/v${version}`
}

/** The toast after a restart; after an update, it links the release notes. */
function showRunning(version: string, updated: boolean, id?: string) {
  toast.success(
    updated ? `Pico is updated to ${version}` : `Pico ${version} is running`,
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
  ["pico", "server-update", machineId] as const

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
    toast.success(`Pico ${status.installed} is up to date`, {
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

/**
 * Install the newest release, then restart when the agents finish, so the
 * server runs it.
 */
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
      status.latest ? `Installing Pico ${status.latest}…` : "Installing…",
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
    await restartServer({ machineId, now: false, queryClient })
  } catch (error) {
    toast.error("Could not update Pico", {
      id: toastId,
      description: error instanceof Error ? error.message : String(error),
    })
    void queryClient.invalidateQueries({ queryKey: updateStatusKey(machineId) })
  }
}

function turnsText(count: number) {
  return count === 1 ? "1 turn" : `${count} turns`
}

/**
 * A row in the sidebar footer while the server waits for active turns to
 * finish before it restarts. It also shows a restart from the command line.
 */
export function ServerRestartStatus() {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const health = useServerHealth(machineId)
  if (!health?.restart?.pending) {
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
              ? `Installing Pico ${release.latest}…`
              : `Pico ${release.latest} is available`}
          </span>
        </div>
        {release.installing ? null : (
          <TitleTooltip title="Update and restart when agents finish">
            <SidebarMenuAction
              aria-label="Update Pico"
              onClick={() => void updateServer({ machineId, queryClient })}
            >
              <DownloadIcon />
            </SidebarMenuAction>
          </TitleTooltip>
        )}
      </SidebarMenuItem>
    )
  }
  const turns = health.activeTurnCount
  return (
    <SidebarMenuItem>
      <div className="flex h-(--sidebar-item-size) items-center gap-2 rounded-md px-(--sidebar-item-pad) pr-8 text-xs text-muted-foreground">
        <Spinner size="xs" aria-label="Restarting" />
        <span className="min-w-0 truncate">
          {turns > 0
            ? `Restarts after ${turnsText(turns)}`
            : "Pico is restarting…"}
        </span>
      </div>
      {turns > 0 ? (
        <TitleTooltip title="Restart now">
          <SidebarMenuAction
            aria-label="Restart now"
            onClick={() =>
              void restartServer({ machineId, now: true, queryClient })
            }
          >
            <ZapIcon />
          </SidebarMenuAction>
        </TitleTooltip>
      ) : null}
    </SidebarMenuItem>
  )
}

function ServerPage() {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const health = useServerHealth(machineId)
  const pending = Boolean(health?.restart?.pending)
  const turns = health?.activeTurnCount ?? 0
  const canRestart = Boolean(health?.restart)
  const restart = (now: boolean) =>
    void restartServer({ machineId, now, queryClient })
  const update = useUpdateStatus(machineId)

  const version: SettingsItem = {
    id: "version",
    title: health ? `Pico ${health.version}` : "Pico",
    description: health?.update?.available
      ? health.update.version
        ? `Version ${health.update.version} is installed. A restart runs it.`
        : "A newer build is on disk. A restart runs it."
      : "The server runs the newest build on disk.",
    value: health?.update?.available ? "Update ready" : undefined,
    disabled: true,
  }
  const updateItems = update
    ? updateSettingsItems({ status: update, machineId, queryClient, pending })
    : []
  const items: Array<SettingsItem> = canRestart
    ? [
        {
          id: "restart",
          title: "Restart when agents finish",
          description: pending
            ? `Pico restarts when ${turns} active turn(s) finish.`
            : turns > 0
              ? `${turns} active turn(s) finish first. New prompts wait until Pico is back.`
              : "No agent works now, so Pico restarts at once.",
          icon: <RotateCwIcon />,
          busy: pending,
          disabled: pending,
          onSelect: () => restart(false),
        },
        {
          id: "restart-now",
          title: "Restart now",
          description:
            "Do not wait. Turns that the restart cuts off continue after it; a running tool call starts again or ends with an error.",
          icon: <ZapIcon />,
          onSelect: () => restart(true),
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
  pending,
}: {
  status: UpdateStatus
  machineId: string
  queryClient: QueryClient
  /** A restart waits for turns. */
  pending: boolean
}): Array<SettingsItem> {
  const latest = status.latest
  const items: Array<SettingsItem> = []
  if (status.available && latest && status.install === "npm")
    items.push({
      id: "update",
      title: `Update to Pico ${latest}`,
      description: status.installing
        ? "Installing with npm. Pico restarts when the agents finish."
        : "Install it with npm, then restart when the agents finish.",
      keywords: ["update", "upgrade", "install", "new version"],
      icon: <DownloadIcon />,
      busy: status.installing,
      disabled: status.installing || pending,
      onSelect: () => void updateServer({ machineId, queryClient }),
    })
  else if (status.available && latest && status.command) {
    const command = status.command
    items.push({
      id: "update-command",
      title: `Pico ${latest} is available`,
      description: `Pico cannot update this install by itself. Run: ${command}`,
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
            ? "This Pico runs from a source checkout; update it with git."
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
