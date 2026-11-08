import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  registerSettingsPage,
  SettingsListPage,
  useOpenSettingsPage,
  type SettingsPageProps,
} from "@/features/pico/settings-pages"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"
import { settle } from "@/lib/settle"

type McpServer = {
  name: string
  connected: boolean
  toolCount: number
  error?: string
  transport: "http" | "stdio"
  needsAuth: boolean
  signedIn: boolean
}

function statusText(server: McpServer) {
  const status = server.connected
    ? `Connected · ${server.toolCount} tools`
    : server.needsAuth
      ? "Needs sign-in"
      : (server.error ?? "Not connected")
  return server.signedIn ? `${status} · signed in` : status
}

function StatusDot({ server }: { server: McpServer }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 rounded-full",
        server.connected
          ? "bg-emerald-500"
          : server.needsAuth
            ? "bg-amber-500"
            : "bg-destructive"
      )}
    />
  )
}

function useMcpServers(viewerContextId: string) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const queryKey = ["pico", "mcp-servers", machineId, viewerContextId]
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<{ servers: Array<McpServer> }>(
        buildRequestUrl("/api/mcp/servers", {
          machineId,
          contextId: viewerContextId,
        })
      ),
    refetchInterval: 5000,
  })
  const action = useMutation({
    mutationFn: async ({
      name,
      kind,
    }: {
      name: string
      kind: "auth" | "signout" | "reconnect"
    }) => {
      // Open the window first: browsers block windows opened after an await.
      const popup = kind === "auth" ? window.open("", "_blank") : null
      const settled = await settle(
        fetchJson<{
          authorizationUrl?: string
          authorized?: boolean
        }>(
          buildRequestUrl(`/api/mcp/${encodeURIComponent(name)}/${kind}`, {
            machineId,
            contextId: viewerContextId,
          }),
          { method: "POST" }
        )
      )
      if (!settled.ok) {
        const error = settled.error
        popup?.close()
        throw error
      }
      const result = settled.value
      if (result.authorizationUrl) {
        if (popup) popup.location.href = result.authorizationUrl
        else window.location.href = result.authorizationUrl
      } else popup?.close()
      return result
    },
    onSuccess: (result, variables) => {
      if (variables.kind === "auth")
        toast.info(
          result.authorized
            ? `Signed in to ${variables.name}`
            : `Finish the sign-in to ${variables.name} in the new tab`
        )
      else if (variables.kind === "signout")
        toast.success(`Signed out of ${variables.name}`)
      else toast.success(`Reconnected ${variables.name}`)
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return { query, action }
}

function McpServersPage({ viewerContextId }: SettingsPageProps) {
  const open = useOpenSettingsPage()
  const { query } = useMcpServers(viewerContextId)
  return (
    <SettingsListPage
      title="MCP servers"
      subtitle="Add servers to the mcp.json file of Pi."
      loading={query.isPending}
      emptyText="No MCP servers. Add them to the mcp.json file of Pi."
      groups={[
        {
          items: (query.data?.servers ?? []).map((server) => ({
            id: server.name,
            icon: <StatusDot server={server} />,
            title: server.name,
            description: statusText(server),
            submenu: true,
            onSelect: () =>
              open({ key: "agent-mcp-server", params: { name: server.name } }),
          })),
        },
      ]}
    />
  )
}

function McpServerPage({ viewerContextId, params }: SettingsPageProps) {
  const { query, action } = useMcpServers(viewerContextId)
  const server = query.data?.servers.find((item) => item.name === params.name)
  const name = params.name ?? ""
  const busy = action.isPending
  const run = (kind: "auth" | "signout" | "reconnect") =>
    action.mutate({ name, kind })
  return (
    <SettingsListPage
      title={name}
      subtitle={server ? statusText(server) : undefined}
      loading={query.isPending}
      emptyText="This server is not in mcp.json now."
      groups={[
        {
          items: server
            ? [
                ...(server.transport === "http"
                  ? [
                      server.signedIn
                        ? {
                            id: "signout",
                            title: "Sign out",
                            busy,
                            disabled: busy,
                            onSelect: () => run("signout"),
                          }
                        : {
                            id: "auth",
                            title: "Sign in",
                            description: "Opens the sign-in page in a new tab.",
                            busy,
                            disabled: busy,
                            onSelect: () => run("auth"),
                          },
                    ]
                  : []),
                {
                  id: "reconnect",
                  title: "Reconnect",
                  busy,
                  disabled: busy,
                  onSelect: () => run("reconnect"),
                },
              ]
            : [],
        },
      ]}
    />
  )
}

registerSettingsPage({
  key: "agent-mcp",
  Component: McpServersPage,
  entry: {
    group: "Agent",
    title: "MCP servers",
    description: "The state of each server, sign-in, and reconnect.",
    keywords: ["mcp", "servers", "sign in", "oauth", "reconnect"],
    order: 50,
    feature: "mcp",
  },
})
registerSettingsPage({ key: "agent-mcp-server", Component: McpServerPage })
