import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  HammerIcon,
  ScanSearchIcon,
  SlidersHorizontalIcon,
  TelescopeIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  registerAgentSettingsSection,
  SettingsSection,
} from "@/features/pico/agent/agent-settings-dialog"
import { sessionExtensionsQueryKey } from "@/features/pico/agent/session-extensions"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useMachineFeature } from "@/features/pico/machine-store"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type Profile = {
  name: string
  description: string
  extensions?: Array<string>
  removeTools?: Array<string>
  instructions?: string
}

/** A profile name for display: "read-only" shows as "Read-only". */
export function profileLabel(name: string) {
  return name ? name[0]!.toUpperCase() + name.slice(1) : name
}

const PROFILE_ICONS: Record<string, LucideIcon> = {
  full: WrenchIcon,
  builder: HammerIcon,
  researcher: TelescopeIcon,
  reviewer: ScanSearchIcon,
  "read-only": EyeIcon,
}

/** The icon of a profile. The user's own profiles get the sliders icon. */
function ProfileIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const Icon = PROFILE_ICONS[name] ?? SlidersHorizontalIcon
  return (
    <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
  )
}

type ProfilesResponse = { ok: true; profiles: Array<Profile>; current: string }

function useProfiles(viewerContextId: string, sessionId?: string) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: ["pico", "profiles", viewerContextId, sessionId ?? "draft"],
    queryFn: () =>
      fetchJson<ProfilesResponse>(
        buildRequestUrl("/api/profiles", {
          machineId,
          contextId: viewerContextId,
          sessionId,
        })
      ),
    enabled: Boolean(viewerContextId),
  })
}

type ProfileTarget = {
  cwd?: string
  sessionId?: string
  viewerContextId: string
}

/** The profiles, and a mutation that sets the profile of a session or of the draft. */
function useProfileSelection({
  cwd,
  sessionId,
  viewerContextId,
}: ProfileTarget) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId, sessionId)
  const mutation = useMutation({
    mutationFn: (profile: string) =>
      fetchJson<{ profile: string }>(
        buildRequestUrl("/api/session/profile", {
          machineId,
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
  return { data: query.data, mutation }
}

/** The menu items of the profiles, with a check on the current one. */
function ProfileMenuItems({
  data,
  onSelect,
}: {
  data: ProfilesResponse
  onSelect: (name: string) => void
}) {
  return data.profiles.map((profile) => (
    <DropdownMenuItem key={profile.name} onClick={() => onSelect(profile.name)}>
      <ProfileIcon
        name={profile.name}
        className="mt-0.5 self-start text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{profileLabel(profile.name)}</span>
        <span className="text-xs text-muted-foreground">
          {profile.description}
        </span>
      </div>
      {profile.name === data.current ? (
        <CheckIcon className="ml-2 size-4 shrink-0" />
      ) : null}
    </DropdownMenuItem>
  ))
}

/** A dropdown that sets the tool profile of a session or of the new-session draft. */
function ProfilePickerView({
  variant = "ghost",
  ...target
}: ProfileTarget & { variant?: "ghost" | "outline" }) {
  const { data, mutation } = useProfileSelection(target)
  if (!data) return null
  const current = data.current
  return (
    <DropdownMenu>
      <TitleTooltip title="Tool profile: which tools the agent can use">
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
          <ProfileIcon name={current} />
          <span className="truncate">{profileLabel(current)}</span>
          <ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
      </TitleTooltip>
      <DropdownMenuContent align="start" className="w-80">
        <ProfileMenuItems
          data={data}
          onSelect={(name) => mutation.mutate(name)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A submenu that sets the tool profile, for a menu such as the session menu. */
function ProfileMenuSubView({
  className,
  ...target
}: ProfileTarget & { className?: string }) {
  const { data, mutation } = useProfileSelection(target)
  if (!data) return null
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className={className}
        disabled={mutation.isPending}
      >
        <span className="flex-1">Tool profile</span>
        <span className="text-muted-foreground">
          {profileLabel(data.current)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <ProfileMenuItems
          data={data}
          onSelect={(name) => mutation.mutate(name)}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

const EXAMPLE = `{
  "docs": {
    "description": "Write documentation only",
    "removeTools": ["bash"],
    "instructions": "Change only markdown files."
  }
}`

function ProfilesSettings({ viewerContextId }: { viewerContextId: string }) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId)
  const [text, setText] = React.useState<string | null>(null)
  const builtIn = new Set(Object.keys(PROFILE_ICONS))
  const custom = Object.fromEntries(
    (query.data?.profiles ?? [])
      .filter((profile) => !builtIn.has(profile.name) || false)
      .map(({ name, ...profile }) => [name, profile])
  )
  const save = useMutation({
    mutationFn: (profiles: unknown) =>
      fetchJson(
        buildRequestUrl("/api/settings/profiles", {
          machineId,
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
            <li key={profile.name} className="flex items-start gap-1.5 text-xs">
              <ProfileIcon
                name={profile.name}
                className="mt-px size-3.5 text-muted-foreground"
              />
              <span>
                <span className="font-medium">
                  {profileLabel(profile.name)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  — {profile.description}
                </span>
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
  feature: "tool-profiles",
  key: "profiles",
  order: 10,
  Component: ProfilesSettings,
})

/** Hidden when the server of the page does not have the feature. */
export function ProfilePicker(
  props: React.ComponentProps<typeof ProfilePickerView>
) {
  const available = useMachineFeature("tool-profiles")
  return available ? <ProfilePickerView {...props} /> : null
}

/** Hidden when the server of the page does not have the feature. */
export function ProfileMenuSub(
  props: React.ComponentProps<typeof ProfileMenuSubView>
) {
  const available = useMachineFeature("tool-profiles")
  return available ? <ProfileMenuSubView {...props} /> : null
}
