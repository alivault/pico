/**
 * Import cookies from the user's own browser into the agent's browser
 * (server/src/services/browser-cookie-import.ts), so that sites open signed
 * in, in every agent. A card in the Agent's browser offers it one time; the
 * settings have a Browser page with the status and the actions. The client
 * sees only sites and counts, never cookie values.
 */
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, CookieIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { emitPicoEvent, usePicoEvent } from "@/features/pico/agent/events"
import { errorText } from "@/features/pico/agent/shared"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  useMachineFeature,
  useMachineReadOnly,
} from "@/features/pico/machine-store"
import {
  registerSettingsPage,
  SettingsListPage,
  type SettingsPageProps,
} from "@/features/pico/settings-pages"
import { useMachineId } from "@/lib/pico/machine-context"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"
import { toast } from "@/lib/pico/toast"
import { cn } from "@/lib/utils"

export const COOKIE_IMPORT_FEATURE = "browser-cookie-import"

type BrowserId = "chrome" | "edge" | "brave" | "arc" | "chromium" | "firefox"

type BrowserProfile = {
  id: string
  browser: BrowserId
  browserName: string
  name: string
}

type SiteTag = "Email" | "Bank or payments" | "Sign-in provider"

type CookieSite = { domain: string; count: number; tag?: SiteTag }

type SitesResult = {
  profile: BrowserProfile
  sites: Array<CookieSite>
  total: number
  skipped: number
  warning?: string
}

type ImportStatus = {
  imported: boolean
  count: number
  source?: { browser: BrowserId; browserName: string; profileName: string }
  importedAt?: string
}

const statusKey = (machineId: string) => ["pico", "browser-cookies", machineId]

function cookiesUrl(machineId: string, path = "") {
  return buildRequestUrl(`/api/browser/cookies${path}`, {
    machineId,
    contextId: "default",
  })
}

function postJson<T>(url: string, body: unknown) {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Whether cookies are imported on this machine. */
export function useCookieImportStatus(enabled = true) {
  const machineId = useMachineId()
  return useQuery({
    queryKey: statusKey(machineId),
    queryFn: () =>
      fetchJson<ImportStatus & { ok: true }>(cookiesUrl(machineId)),
    enabled,
    staleTime: 60_000,
  })
}

/** Open the import dialog of a machine (its shell mounts the dialog). */
export function openCookieImport(machineId: string) {
  emitPicoEvent("pico:open-cookie-import", { machineId })
}

// --- Browser icons ----------------------------------------------------------

const BROWSER_COLORS: Record<BrowserId, string> = {
  chrome: "#4285F4",
  edge: "#0C8CE9",
  brave: "#FB542B",
  arc: "#7C5CFF",
  chromium: "#5B8DEF",
  firefox: "#FF7139",
}

/** A small mark of a browser, in its color. */
export function BrowserIcon({
  browser,
  className,
}: {
  browser: BrowserId
  className?: string
}) {
  if (browser === "chrome")
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={cn("size-4 shrink-0", className)}
      >
        <path d="M12 12 3.34 7A10 10 0 0 1 20.66 7Z" fill="#EA4335" />
        <path d="M12 12 20.66 7A10 10 0 0 1 12 22Z" fill="#FBBC04" />
        <path d="M12 12 12 22A10 10 0 0 1 3.34 7Z" fill="#34A853" />
        <circle cx="12" cy="12" r="4.6" fill="#fff" />
        <circle cx="12" cy="12" r="3.6" fill="#4285F4" />
      </svg>
    )
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="10" fill={BROWSER_COLORS[browser]} />
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#fff"
      >
        {browser === "firefox"
          ? "F"
          : browser === "edge"
            ? "E"
            : browser === "brave"
              ? "B"
              : browser === "arc"
                ? "A"
                : "C"}
      </text>
    </svg>
  )
}

function TagChip({ tag }: { tag: SiteTag }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-px text-[11px] font-medium text-amber-800 dark:text-amber-200">
      {tag}
    </span>
  )
}

// --- The dialog ---------------------------------------------------------------

function ChooseProfileStep({
  profiles,
  loading,
  error,
  profileId,
  onProfileChange,
  reading,
  onCancel,
  onNext,
}: {
  profiles: Array<BrowserProfile>
  loading: boolean
  error?: string
  profileId: string | null
  onProfileChange: (id: string) => void
  reading: boolean
  onCancel: () => void
  onNext: () => void
}) {
  const profile = profiles.find((item) => item.id === profileId)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import cookies from your browser</DialogTitle>
        <DialogDescription>
          Choose the browser profile to import cookies from.
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="xs" /> Looking for browsers…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Found no Chrome, Edge, Brave, Arc, Chromium, or Firefox profiles on
          this computer.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="cookie-import-profile"
            className="text-sm font-medium"
          >
            From
          </label>
          <Select
            value={profileId}
            onValueChange={(value) => {
              if (typeof value === "string") onProfileChange(value)
            }}
            disabled={reading}
          >
            <SelectTrigger id="cookie-import-profile" className="w-full">
              <SelectValue>
                {profile ? (
                  <ProfileLabel profile={profile} />
                ) : (
                  "Choose a profile"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {profiles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <ProfileLabel profile={item} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Nothing leaves this computer.
            {profile && profile.browser !== "firefox"
              ? ` macOS may ask for your Mac login password to unlock ${profile.browserName}'s cookies. Enter it and choose Allow.`
              : null}
          </p>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!profile || reading} onClick={onNext}>
          {reading ? <Spinner size="xs" /> : null}
          {reading ? "Reading cookies…" : "Import"}
        </Button>
      </DialogFooter>
    </>
  )
}

function ProfileLabel({ profile }: { profile: BrowserProfile }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BrowserIcon browser={profile.browser} />
      <span className="truncate">
        {profile.browserName}
        <span className="text-muted-foreground"> · {profile.name}</span>
      </span>
    </span>
  )
}

function ChooseSitesStep({
  result,
  selected,
  onSelectedChange,
  importing,
  onBack,
  onImport,
}: {
  result: SitesResult
  selected: ReadonlySet<string>
  onSelectedChange: (next: Set<string>) => void
  importing: boolean
  onBack: () => void
  onImport: () => void
}) {
  const [filter, setFilter] = React.useState("")
  const words = filter.trim().toLowerCase()
  const shown = words
    ? result.sites.filter(
        (site) =>
          site.domain.includes(words) || site.tag?.toLowerCase().includes(words)
      )
    : result.sites
  const shownSelected = shown.filter((site) => selected.has(site.domain))
  const allShown = shown.length > 0 && shownSelected.length === shown.length
  const someShown = shownSelected.length > 0 && !allShown

  const toggleAll = (checked: boolean) => {
    const next = new Set(selected)
    for (const site of shown) {
      if (checked) next.add(site.domain)
      else next.delete(site.domain)
    }
    onSelectedChange(next)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose sites to import</DialogTitle>
        <DialogDescription>
          Sites with cookies in your {result.profile.browserName} profile "
          {result.profile.name}".
        </DialogDescription>
      </DialogHeader>
      {result.warning ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {result.warning}
        </p>
      ) : null}
      {result.sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This profile has no cookies to import.
        </p>
      ) : (
        // min-w-0: a long site name must not make the dialog's grid column
        // wider than the dialog. The name truncates in its row.
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Filter sites"
              placeholder="Filter sites"
              className="pl-8"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm">
            <Checkbox
              id="cookie-import-all"
              checked={allShown}
              indeterminate={someShown}
              disabled={shown.length === 0}
              onCheckedChange={(checked) => toggleAll(checked)}
            />
            <label
              htmlFor="cookie-import-all"
              className="flex-1 cursor-pointer font-medium"
            >
              Select all
            </label>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {selected.size} of {result.sites.length} selected
            </span>
          </div>
          <div
            role="group"
            aria-label="Sites"
            className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-border/70"
          >
            {shown.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No sites match.
              </p>
            ) : (
              shown.map((site) => {
                const id = `cookie-import-site-${site.domain}`
                return (
                  <div
                    key={site.domain}
                    className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5 text-sm last:border-b-0"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.has(site.domain)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected)
                        if (checked) next.add(site.domain)
                        else next.delete(site.domain)
                        onSelectedChange(next)
                      }}
                    />
                    <label
                      htmlFor={id}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      <span className="truncate">{site.domain}</span>
                      {site.tag ? <TagChip tag={site.tag} /> : null}
                    </label>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {site.count}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={importing} onClick={onBack}>
          Back
        </Button>
        <Button disabled={selected.size === 0 || importing} onClick={onImport}>
          {importing ? <Spinner size="xs" /> : null}
          Import
        </Button>
      </DialogFooter>
    </>
  )
}

function CookieImportDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const [profileId, setProfileId] = React.useState<string | null>(null)
  const [sites, setSites] = React.useState<SitesResult | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const profiles = useQuery({
    queryKey: ["pico", "browser-cookie-profiles", machineId],
    queryFn: () =>
      fetchJson<{ ok: true; profiles: Array<BrowserProfile> }>(
        cookiesUrl(machineId, "/profiles")
      ),
    staleTime: 0,
  })
  const list = profiles.data?.profiles ?? []
  const chosen = profileId ?? list[0]?.id ?? null

  const read = useMutation({
    mutationFn: (id: string) =>
      postJson<SitesResult & { ok: true }>(cookiesUrl(machineId, "/sites"), {
        profileId: id,
      }),
    onSuccess: (data) => {
      setSites(data)
      // All sites start selected.
      setSelected(new Set(data.sites.map((site) => site.domain)))
    },
    onError: (error) => toast.error(errorText(error)),
  })

  const save = useMutation({
    mutationFn: (input: { profileId: string; domains: Array<string> }) =>
      postJson<ImportStatus & { ok: true; added: number }>(
        cookiesUrl(machineId, "/import"),
        input
      ),
    onSuccess: (data, input) => {
      queryClient.setQueryData(statusKey(machineId), data)
      toast.success(
        `Imported ${data.added} ${data.added === 1 ? "cookie" : "cookies"} from ${input.domains.length} ${input.domains.length === 1 ? "site" : "sites"}`
      )
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorText(error)),
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {sites ? (
          <ChooseSitesStep
            result={sites}
            selected={selected}
            onSelectedChange={setSelected}
            importing={save.isPending}
            onBack={() => setSites(null)}
            onImport={() =>
              save.mutate({
                profileId: sites.profile.id,
                // In the order of the list.
                domains: sites.sites
                  .map((site) => site.domain)
                  .filter((domain) => selected.has(domain)),
              })
            }
          />
        ) : (
          <ChooseProfileStep
            profiles={list}
            loading={profiles.isPending}
            error={profiles.error ? errorText(profiles.error) : undefined}
            profileId={chosen}
            onProfileChange={setProfileId}
            reading={read.isPending}
            onCancel={() => onOpenChange(false)}
            onNext={() => {
              if (chosen) read.mutate(chosen)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Mounted once in each machine's shell; opens on `pico:open-cookie-import`
 * for its machine.
 */
export function CookieImportDialogController() {
  const machineId = useMachineId()
  const [open, setOpen] = React.useState(false)
  usePicoEvent("pico:open-cookie-import", (detail) => {
    if (detail.machineId === machineId) setOpen(true)
  })
  return open ? <CookieImportDialog onOpenChange={setOpen} /> : null
}

// --- The card -----------------------------------------------------------------

function dismissedKey(machineId: string) {
  return `pico-cookie-import-dismissed:${machineId}`
}

/** Machines where the user chose "Not now" in this page. */
const notNow = new Set<string>()

/**
 * The offer in the Agent's browser, one time: when nothing is imported and
 * the user did not dismiss it.
 */
export function CookieImportCard() {
  const machineId = useMachineId()
  const readOnly = useMachineReadOnly()
  const supported = useMachineFeature(COOKIE_IMPORT_FEATURE)
  const [hidden, setHidden] = React.useState(
    () =>
      notNow.has(machineId) ||
      safeLocalStorageGetItem(dismissedKey(machineId)) === "1"
  )
  const status = useCookieImportStatus(supported && !readOnly && !hidden)
  if (hidden || readOnly || !supported || !status.data || status.data.imported)
    return null

  const hide = (forever: boolean) => {
    if (forever) safeLocalStorageSetItem(dismissedKey(machineId), "1")
    else notNow.add(machineId)
    setHidden(true)
  }

  return (
    <div
      role="region"
      aria-label="Stay signed in to your sites"
      className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-sm flex-col gap-3 rounded-xl border border-border/70 bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-1.5">
        <BrowserIcon browser="chrome" className="size-5" />
        <BrowserIcon browser="firefox" className="size-5" />
        <BrowserIcon browser="edge" className="size-5" />
        <BrowserIcon browser="brave" className="size-5" />
        <BrowserIcon browser="arc" className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="font-heading text-base font-medium">
          Stay signed in to your sites
        </div>
        <p className="text-muted-foreground">
          Import cookies from your browser so your sites open signed in, here
          and in every session.
        </p>
      </div>
      <ul className="flex flex-col gap-1 text-muted-foreground">
        {[
          "Cookies and site data only. Passwords aren't imported.",
          "You choose the sites.",
          "Nothing leaves this computer.",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="link"
          size="sm"
          className="px-0 text-muted-foreground"
          onClick={() => hide(true)}
        >
          Don't show again
        </Button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => hide(false)}>
          Not now
        </Button>
        <Button
          size="sm"
          onClick={() => {
            hide(false)
            openCookieImport(machineId)
          }}
        >
          Import cookies
        </Button>
      </div>
    </div>
  )
}

// --- Settings -------------------------------------------------------------------

function sourceText(status: ImportStatus) {
  if (!status.source) return undefined
  const date = status.importedAt
    ? new Date(status.importedAt).toLocaleDateString()
    : undefined
  return [
    `From ${status.source.browserName} (${status.source.profileName})`,
    date ? `imported ${date}` : undefined,
  ]
    .filter(Boolean)
    .join(", ")
}

function BrowserSettingsPage(_props: SettingsPageProps) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const readOnly = useMachineReadOnly()
  const status = useCookieImportStatus()
  const remove = useMutation({
    mutationFn: () =>
      fetchJson<ImportStatus & { ok: true }>(cookiesUrl(machineId), {
        method: "DELETE",
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(statusKey(machineId), data)
      toast.success("Removed the imported cookies")
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const data = status.data
  return (
    <SettingsListPage
      title="Browser"
      subtitle="Cookies for the agent's browser."
      loading={status.isPending}
      note={
        status.error
          ? errorText(status.error)
          : "Imported cookies go to the agent's browser in every session. A session's own cookies win. Passwords are not imported."
      }
      groups={
        data
          ? [
              {
                heading: "Imported cookies",
                items: [
                  {
                    id: "status",
                    icon: <CookieIcon />,
                    title: data.imported
                      ? `${data.count} ${data.count === 1 ? "cookie" : "cookies"} imported`
                      : "No cookies imported",
                    description: data.imported
                      ? sourceText(data)
                      : "Sites in the agent's browser open signed out.",
                  },
                  {
                    id: "import",
                    title: "Import cookies…",
                    description:
                      "From Chrome, Edge, Brave, Arc, Chromium, or Firefox on this computer.",
                    keywords: ["cookies", "import", "sign in", "login"],
                    disabled: readOnly,
                    onSelect: () => openCookieImport(machineId),
                  },
                  {
                    id: "remove",
                    title: "Remove imported cookies",
                    description:
                      "The agent's browser keeps the cookies of its own sessions.",
                    destructive: true,
                    busy: remove.isPending,
                    disabled: readOnly || !data.imported || remove.isPending,
                    onSelect: () => remove.mutate(),
                  },
                ],
              },
            ]
          : []
      }
    />
  )
}

registerSettingsPage({
  key: "agent-browser",
  Component: BrowserSettingsPage,
  entry: {
    group: "Agent",
    title: "Browser",
    description: "Import cookies from your browser into the agent's browser.",
    keywords: ["browser", "cookies", "import", "sign in", "login", "chrome"],
    order: 35,
    feature: COOKIE_IMPORT_FEATURE,
  },
})
