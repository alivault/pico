import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  registerAgentSettingsSection,
  SettingsSection,
} from "@/features/pico/agent/agent-settings-dialog"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { cn } from "@/lib/utils"

type McpServer = {
  name: string
  connected: boolean
  toolCount: number
  error?: string
  transport: "http" | "stdio"
  needsAuth: boolean
  signedIn: boolean
}

function McpSettings({ viewerContextId }: { viewerContextId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ["pico", "mcp-servers", viewerContextId]
  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<{ servers: Array<McpServer> }>(
        buildRequestUrl("/api/mcp/servers", { contextId: viewerContextId })
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
      try {
        const result = await fetchJson<{
          authorizationUrl?: string
          authorized?: boolean
        }>(
          buildRequestUrl(`/api/mcp/${encodeURIComponent(name)}/${kind}`, {
            contextId: viewerContextId,
          }),
          { method: "POST" }
        )
        if (result.authorizationUrl) {
          if (popup) popup.location.href = result.authorizationUrl
          else window.location.href = result.authorizationUrl
        } else popup?.close()
        return result
      } catch (error) {
        popup?.close()
        throw error
      }
    },
    onSuccess: (result, variables) => {
      if (variables.kind === "auth")
        toast.info(
          result.authorized
            ? `Signed in to ${variables.name}`
            : `Finish the sign-in to ${variables.name} in the new tab`
        )
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const servers = query.data?.servers ?? []
  return (
    <SettingsSection title="MCP servers">
      {query.isPending ? (
        <div className="py-2">
          <Spinner size="xs" />
        </div>
      ) : servers.length === 0 ? (
        <div className="py-2 text-xs text-muted-foreground">
          No MCP servers. Add them to Pi&apos;s mcp.json.
        </div>
      ) : (
        servers.map((server) => (
          <div
            key={server.name}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
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
                {server.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {server.connected
                  ? `Connected · ${server.toolCount} tools`
                  : server.needsAuth
                    ? "Needs sign-in"
                    : (server.error ?? "Not connected")}
                {server.signedIn ? " · signed in" : ""}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {server.transport === "http" ? (
                server.signedIn ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ name: server.name, kind: "signout" })
                    }
                  >
                    Sign out
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={server.needsAuth ? "default" : "outline"}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ name: server.name, kind: "auth" })
                    }
                  >
                    Sign in
                  </Button>
                )
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ name: server.name, kind: "reconnect" })
                }
              >
                Reconnect
              </Button>
            </div>
          </div>
        ))
      )}
    </SettingsSection>
  )
}

registerAgentSettingsSection({
  key: "mcp",
  order: 20,
  Component: McpSettings,
})
