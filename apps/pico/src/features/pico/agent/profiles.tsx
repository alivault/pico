import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  EyeIcon,
  HammerIcon,
  ScanSearchIcon,
  SlidersHorizontalIcon,
  TelescopeIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "@/lib/pico/toast"

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { agentExtensionsQueryKey } from "@/features/pico/agent/agent-extensions"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { useMachineFeature } from "@/features/pico/machine-store"
import {
  registerSettingsPage,
  SettingsEditPage,
  SettingsListPage,
  useOpenSettingsPage,
  type SettingsPageProps,
} from "@/features/pico/settings-pages"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type Profile = {
  name: string
  description: string
  extensions?: Array<string>
  removeTools?: Array<string>
  instructions?: string
  bash?: "sandbox"
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

function useProfiles(viewerContextId: string, agentId?: string) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: ["pico", "profiles", viewerContextId, agentId ?? "draft"],
    queryFn: () =>
      fetchJson<ProfilesResponse>(
        buildRequestUrl("/api/profiles", {
          machineId,
          contextId: viewerContextId,
          agentId,
        })
      ),
    enabled: Boolean(viewerContextId),
  })
}

type ProfileTarget = {
  cwd?: string
  agentId?: string
  viewerContextId: string
}

/** The profiles, and a mutation that sets the profile of an agent or of the draft. */
function useProfileSelection({ cwd, agentId, viewerContextId }: ProfileTarget) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId, agentId)
  const mutation = useMutation({
    mutationFn: (profile: string) =>
      fetchJson<{ profile: string }>(
        buildRequestUrl("/api/agent/profile", {
          machineId,
          contextId: viewerContextId,
          agentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile, ...(cwd ? { cwd } : {}) }),
        }
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["pico", "profiles", viewerContextId, agentId ?? "draft"],
        (current: ProfilesResponse | undefined) =>
          current ? { ...current, current: data.profile } : current
      )
      if (agentId)
        void queryClient.invalidateQueries({
          queryKey: agentExtensionsQueryKey(viewerContextId, agentId),
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

/** A submenu that sets the tool profile, for a menu such as the agent menu. */
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

/** The profiles that the user made or changed, as the JSON to edit. */
function customProfiles(profiles: Array<Profile>) {
  const builtIn = new Set(Object.keys(PROFILE_ICONS))
  return Object.fromEntries(
    profiles
      .filter((profile) => !builtIn.has(profile.name))
      .map(({ name, ...profile }) => [name, profile])
  )
}

function ProfilesPage({ viewerContextId }: SettingsPageProps) {
  const open = useOpenSettingsPage()
  const query = useProfiles(viewerContextId)
  const profiles = query.data?.profiles ?? []
  const custom = customProfiles(profiles)
  const edit = () => open({ key: "agent-profiles-edit" })
  return (
    <SettingsListPage
      title="Tool profiles"
      subtitle="Which tools an agent can use. Choose one in the composer."
      loading={query.isPending}
      groups={[
        {
          items: [
            {
              id: "edit",
              title: "Edit your profiles",
              description: "Add profiles, or change a built-in one, as JSON.",
              value: Object.keys(custom).length
                ? String(Object.keys(custom).length)
                : undefined,
              submenu: true,
              onSelect: edit,
            },
          ],
        },
        {
          heading: "Profiles",
          items: profiles.map((profile) => ({
            id: `profile:${profile.name}`,
            icon: <ProfileIcon name={profile.name} />,
            title: profileLabel(profile.name),
            description: profile.description,
            value: profile.name in custom ? "Yours" : "Built-in",
            onSelect: edit,
          })),
        },
      ]}
    />
  )
}

function EditProfilesPage({ viewerContextId }: SettingsPageProps) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const query = useProfiles(viewerContextId)
  if (!query.data) return null
  const custom = customProfiles(query.data.profiles)
  return (
    <SettingsEditPage
      multiline
      title="Edit your profiles"
      initial={
        Object.keys(custom).length ? JSON.stringify(custom, null, 2) : ""
      }
      placeholder={EXAMPLE}
      description={
        <>
          Each profile can have <code>description</code>,{" "}
          <code>extensions</code> (exactly these), <code>removeTools</code>,{" "}
          <code>instructions</code>, and <code>"bash": "sandbox"</code> (bash
          with a read-only file system and no network). A profile with a
          built-in name replaces it.
        </>
      }
      onSave={async (value) => {
        let profiles: unknown
        try {
          profiles = JSON.parse(value.trim() || "{}")
        } catch (error) {
          return `The JSON is not valid: ${errorText(error)}`
        }
        try {
          await fetchJson(
            buildRequestUrl("/api/settings/profiles", {
              machineId,
              contextId: viewerContextId,
            }),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ profiles }),
            }
          )
        } catch (error) {
          return errorText(error)
        }
        toast.success("Saved the profiles")
        await queryClient.invalidateQueries({ queryKey: ["pico", "profiles"] })
        return undefined
      }}
    />
  )
}

registerSettingsPage({
  key: "agent-profiles",
  Component: ProfilesPage,
  entry: {
    group: "Agent",
    title: "Tool profiles",
    description: "Which tools an agent can use, and your own profiles.",
    keywords: ["profiles", "tools", "builder", "reviewer", "read-only"],
    order: 40,
    feature: "tool-profiles",
  },
})
registerSettingsPage({
  key: "agent-profiles-edit",
  Component: EditProfilesPage,
})

/** Hidden when the server of the page does not have the feature. */
export function ProfileMenuSub(
  props: React.ComponentProps<typeof ProfileMenuSubView>
) {
  const available = useMachineFeature("tool-profiles")
  return available ? <ProfileMenuSubView {...props} /> : null
}
