/**
 * The server of a machine: its version, a newer build on disk, and a
 * restart that loads it. Turns that a restart cuts off continue after it,
 * and terminals and jobs run on in the pty-host.
 */
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { RotateCwIcon, ZapIcon } from "lucide-react"

import { fetchJson } from "@/features/pico/app-shell-utils"
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
  webBuild?: string
}

export const SERVER_RESTART_FEATURE = "server-restart"

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
  return `v${health.version}`
}

/** Wait until a new server process answers, and give its health. */
async function waitForNewServer(machineId: string, before: ServerHealth) {
  const deadline = Date.now() + 12 * 60_000
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
    toast.loading("Pico is restarting…", {
      id: toastId,
      description:
        !now && started.activeTurnCount > 0
          ? `It waits for ${started.activeTurnCount} active turn(s) to finish.`
          : undefined,
    })
    void queryClient.invalidateQueries({ queryKey: serverHealthKey(machineId) })
    const after = await waitForNewServer(machineId, before)
    if (!after) {
      toast.error("Pico did not start again in time", {
        id: toastId,
        description: "Look at the server log.",
      })
      return
    }
    queryClient.setQueryData(serverHealthKey(machineId), after)
    // This page comes from the local server. Load its new web client too.
    if (
      !isRemoteMachine(machineId) &&
      after.webBuild &&
      after.webBuild !== before.webBuild
    ) {
      window.location.reload()
      return
    }
    toast.success(`Pico ${after.version} is running`, {
      id: toastId,
      description: undefined,
    })
  } catch (error) {
    toast.error("Could not restart Pico", {
      id: toastId,
      description: error instanceof Error ? error.message : String(error),
    })
  }
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
      groups={[{ items: [version, ...items] }]}
      note={
        health && !canRestart
          ? "This server cannot restart itself. Restart it where it runs."
          : "Terminals and jobs continue during a restart."
      }
    />
  )
}

registerSettingsPage({ key: "server", Component: ServerPage })
