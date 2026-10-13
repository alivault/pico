import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, ChevronDownIcon, LayersIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  registerAgentSection,
  type AgentSectionProps,
} from "@/features/pico/agent/agent-panel"
import {
  registerAgentSettingsSection,
  SettingsSection,
} from "@/features/pico/agent/agent-settings-dialog"
import { sessionExtensionsQueryKey } from "@/features/pico/agent/session-extensions"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { cn } from "@/lib/utils"

type Profile = {
  name: string
  description: string
  extensions?: Array<string>
  removeTools?: Array<string>
  instructions?: string
}

type ProfilesResponse = { ok: true; profiles: Array<Profile>; current: string }

function useProfiles(viewerContextId: string, sessionId?: string) {
  return useQuery({
    queryKey: ["pico", "profiles", viewerContextId, sessionId ?? "draft"],
    queryFn: () =>
      fetchJson<ProfilesResponse>(
        buildRequestUrl("/api/profiles", {
          contextId: viewerContextId,
          sessionId,
        })
      ),
    enabled: Boolean(viewerContextId),
  })
}

/** A dropdown that sets the tool profile of a session or of the new-session draft. */
export function ProfilePicker({
  cwd,
  sessionId,
  variant = "ghost",
  viewerContextId,
}: {
  cwd?: string
  sessionId?: string
  variant?: "ghost" | "outline"
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId, sessionId)
  const mutation = useMutation({
    mutationFn: (profile: string) =>
      fetchJson<{ profile: string }>(
        buildRequestUrl("/api/session/profile", {
          contextId: viewerContextId,
          sessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile, ...(cwd ? { cwd } : {}) }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["pico", "profiles", viewerContextId, sessionId ?? "draft"],
        (current: ProfilesResponse | undefined) =>
          current ? { ...current, current: data.profile } : current
      )
      if (sessionId)
        void queryClient.invalidateQueries({
          queryKey: sessionExtensionsQueryKey(viewerContextId, sessionId),
        })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const data = query.data
  if (!data) return null
  const current = data.current
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size={variant === "outline" ? "sm" : "default"}
            aria-label="Tool profile"
            disabled={mutation.isPending}
          />
        }
      >
        <LayersIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{current}</span>
        <ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {data.profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.name}
            onClick={() => mutation.mutate(profile.name)}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground">
                {profile.description}
              </span>
            </div>
            {profile.name === current ? (
              <CheckIcon className="ml-2 size-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SessionProfileSection({
  cwd,
  sessionId,
  viewerContextId,
}: AgentSectionProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">Tool profile</span>
      <ProfilePicker
        cwd={cwd}
        sessionId={sessionId}
        variant="outline"
        viewerContextId={viewerContextId}
      />
    </div>
  )
}

registerAgentSection({
  key: "profile",
  title: "Session",
  order: 5,
  visible: () => true,
  Component: SessionProfileSection,
})

const EXAMPLE = `{
  "docs": {
    "description": "Write documentation only",
    "removeTools": ["bash"],
    "instructions": "Change only markdown files."
  }
}`

function ProfilesSettings({ viewerContextId }: { viewerContextId: string }) {
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId)
  const [text, setText] = React.useState<string | null>(null)
  const builtIn = new Set(["full", "research", "read-only", "review"])
  const custom = Object.fromEntries(
    (query.data?.profiles ?? [])
      .filter((profile) => !builtIn.has(profile.name) || false)
      .map(({ name, ...profile }) => [name, profile])
  )
  const save = useMutation({
    mutationFn: (profiles: unknown) =>
      fetchJson(
        buildRequestUrl("/api/settings/profiles", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profiles }),
        }
      ),
    onSuccess: () => {
      toast.success("Saved the profiles")
      setText(null)
      void queryClient.invalidateQueries({ queryKey: ["pico", "profiles"] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const value =
    text ??
    (Object.keys(custom).length ? JSON.stringify(custom, null, 2) : "{}")
  return (
    <SettingsSection title="Tool profiles">
      <div className="space-y-2 py-2 text-sm">
        <ul className="space-y-1">
          {(query.data?.profiles ?? []).map((profile) => (
            <li key={profile.name} className="text-xs">
              <span className="font-medium">{profile.name}</span>
              <span className="text-muted-foreground">
                {" "}
                — {profile.description}
              </span>
            </li>
          ))}
        </ul>
        <div className="text-xs text-muted-foreground">
          Your own profiles, as JSON: <code>extensions</code> (exactly these),{" "}
          <code>removeTools</code>, and <code>instructions</code>. A profile
          with a built-in name replaces it.
        </div>
        <Textarea
          className={cn("min-h-28 font-mono text-xs")}
          value={value}
          placeholder={EXAMPLE}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          size="sm"
          disabled={text === null || save.isPending}
          onClick={() => {
            try {
              save.mutate(JSON.parse(value || "{}"))
            } catch (error) {
              toast.error(`The JSON is not valid: ${errorText(error)}`)
            }
          }}
        >
          Save profiles
        </Button>
      </div>
    </SettingsSection>
  )
}

registerAgentSettingsSection({
  key: "profiles",
  order: 10,
  Component: ProfilesSettings,
})
