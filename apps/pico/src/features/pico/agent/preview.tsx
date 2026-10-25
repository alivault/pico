import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  MonitorIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TitleTooltip } from "@/components/ui/tooltip"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  postSessionJson,
  useSessionExtensions,
} from "@/features/pico/agent/session-extensions"
import { errorText, IconAction } from "@/features/pico/agent/shared"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { ShowContent } from "@/features/pico/tool-renderers/show"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

type PreviewState = {
  target: string
  path: string
  port?: number
  title?: string
  updatedAt: number
}

const WIDTHS = {
  full: undefined,
  tablet: 768,
  phone: 390,
} as const

/** The address of a preview proxy, on the host the browser uses for Pico. */
export function previewAddress(port: number, path: string) {
  const host = window.location.hostname.includes(":")
    ? `[${window.location.hostname}]`
    : window.location.hostname
  return `http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`
}

/** The path, query, and hash of a URL. */
function pagePath(url: URL) {
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The page that the address field asks for: a full URL (only its path is
 * used, because the preview always shows its own dev server) or a path.
 */
function parsePageInput(value: string) {
  const text = value.trim()
  if (!text) return "/"
  try {
    if (/^\w+:\/\//.test(text)) return pagePath(new URL(text))
  } catch {
    // Use the text as a path.
  }
  return text.startsWith("/") ? text : `/${text}`
}

/** A page of a preview at its HTTPS address (from Tailscale Serve). */
function httpsAddress(base: string, path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, base).href
}

export function usePreviewState(viewerContextId: string, sessionId?: string) {
  const query = useSessionExtensions(viewerContextId, sessionId)
  return query.data?.preview as PreviewState | undefined
}

export function PreviewPanel({
  active,
  sessionId,
  viewerContextId,
}: {
  active: boolean
  sessionId?: string
  viewerContextId: string
}) {
  const machineId = useMachineId()
  const preview = usePreviewState(viewerContextId, sessionId)
  // An HTTPS page does not show an HTTP page in a frame, so it asks the
  // server for an HTTPS address of the preview.
  const secure = window.location.protocol === "https:"
  const ensured = useQuery({
    queryKey: [
      "pico",
      "preview-ensure",
      viewerContextId,
      sessionId,
      preview?.target,
      secure,
    ],
    queryFn: () =>
      postSessionJson<
        PreviewState & { port: number; httpsUrl?: string; httpsError?: string }
      >(
        machineId,
        viewerContextId,
        sessionId,
        "/api/session/preview/ensure",
        secure ? { https: true } : {}
      ),
    enabled: Boolean(active && sessionId && preview?.target),
    staleTime: 60_000,
    retry: false,
  })
  const [width, setWidth] = React.useState<keyof typeof WIDTHS>("full")
  // `path` is the page that the frame loads. `currentPath` is the page that
  // it shows now: the preview proxy adds a script to each HTML page that
  // reports its address when it changes. `input` is the address field.
  const [path, setPath] = React.useState(preview?.path ?? "/")
  const [currentPath, setCurrentPath] = React.useState(path)
  const [input, setInput] = React.useState("")
  const [editing, setEditing] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const frameRef = React.useRef<HTMLIFrameElement | null>(null)
  React.useEffect(() => {
    setPath(preview?.path ?? "/")
    setCurrentPath(preview?.path ?? "/")
  }, [preview?.path, preview?.updatedAt])
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { type?: unknown; href?: unknown } | null
      if (data?.type !== "pico-preview-location") return
      if (typeof data.href !== "string") return
      try {
        setCurrentPath(pagePath(new URL(data.href)))
      } catch {
        // Not a URL: keep the last page.
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])
  const shownUrl = preview?.target ? `${preview.target}${currentPath}` : ""
  const openPage = (next: string) => {
    setPath(next)
    setCurrentPath(next)
    setReloadKey((key) => key + 1)
  }

  if (!sessionId || !preview?.target)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No preview yet. Ask the agent to start the app and show it here.
      </div>
    )
  const port = ensured.data?.port ?? preview.port
  const httpsUrl = ensured.data?.httpsUrl
  const address = (page: string) =>
    secure
      ? httpsUrl
        ? httpsAddress(httpsUrl, page)
        : undefined
      : port
        ? previewAddress(port, page)
        : undefined
  const src = address(path)
  const httpUrl = port ? previewAddress(port, currentPath) : undefined
  const blocked = secure && ensured.isSuccess && !httpsUrl
  const openUrl = address(currentPath) ?? httpUrl

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 p-2">
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            openPage(parsePageInput(input))
            setEditing(false)
            ;(
              event.currentTarget.elements[0] as HTMLElement | undefined
            )?.blur()
          }}
        >
          <TitleTooltip title="The page of the app. Press Return to open it.">
            <Input
              value={editing ? input : shownUrl}
              onFocus={(event) => {
                setInput(shownUrl)
                setEditing(true)
                event.currentTarget.select()
              }}
              onBlur={() => setEditing(false)}
              onChange={(event) => setInput(event.target.value)}
              className="h-8 font-mono text-xs"
              aria-label="Page path"
            />
          </TitleTooltip>
        </form>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[width]}
          onValueChange={(values) => {
            const next = values[0] as keyof typeof WIDTHS | undefined
            if (next) setWidth(next)
          }}
          aria-label="Page width"
        >
          {(Object.keys(WIDTHS) as Array<keyof typeof WIDTHS>).map((key) => {
            const Icon =
              key === "full"
                ? MonitorIcon
                : key === "tablet"
                  ? TabletIcon
                  : SmartphoneIcon
            const label =
              key === "full"
                ? "Full width"
                : `${key === "tablet" ? "Tablet" : "Phone"} width (${WIDTHS[key]} px)`
            return (
              <TitleTooltip key={key} title={label}>
                <ToggleGroupItem value={key} aria-label={label}>
                  <Icon />
                </ToggleGroupItem>
              </TitleTooltip>
            )
          })}
        </ToggleGroup>
        <IconAction
          label="Reload"
          icon={<RefreshCwIcon />}
          onClick={() => openPage(currentPath)}
        />
        {openUrl ? (
          <IconAction
            label="Open in a new tab"
            icon={<ExternalLinkIcon />}
            onClick={() =>
              window.open(openUrl, "_blank", "noopener,noreferrer")
            }
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/30">
        {ensured.isError ? (
          <div className="p-6 text-sm text-destructive">
            {errorText(ensured.error)}
          </div>
        ) : blocked ? (
          <div className="max-w-sm p-6 text-sm text-muted-foreground">
            Pico runs on HTTPS here, so the browser does not show the HTTP
            preview in a frame, and the preview has no HTTPS address
            {ensured.data?.httpsError ? ` (${ensured.data.httpsError})` : ""}.{" "}
            {httpUrl ? (
              <>
                <a
                  href={httpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open the HTTP address in a new tab
                </a>
                .
              </>
            ) : null}
          </div>
        ) : !src ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Spinner size="xs" /> Opening the preview…
          </div>
        ) : (
          <iframe
            ref={frameRef}
            key={`${src}:${reloadKey}`}
            title={preview.title ?? "Preview"}
            src={src}
            className={cn(
              "h-full border-0 bg-white",
              width === "full" ? "w-full" : "shrink-0 border-x"
            )}
            style={WIDTHS[width] ? { width: WIDTHS[width] } : undefined}
          />
        )}
      </div>
    </div>
  )
}

function PreviewCard({ block }: ToolRendererProps) {
  const details = toolDetails<{ target: string; path: string; port: number }>(
    block
  )
  const args = toolArgs(block)
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
      <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {details.target
          ? `${details.target}${details.path ?? ""}`
          : typeof args.url === "string"
            ? args.url
            : typeof args.port === "number"
              ? `port ${args.port}`
              : "Preview"}
      </span>
      {block.running ? <Spinner size="xs" /> : null}
      {block.isError ? (
        <span className="truncate text-xs text-destructive">
          {block.output}
        </span>
      ) : details.port ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            emitPicoEvent("pico:open-sidebar-tab", { tab: "preview" })
          }
        >
          Show preview
        </Button>
      ) : null}
    </div>
  )
}

registerToolRenderer("preview_url", { Card: PreviewCard })

function ImageResult({ block }: ToolRendererProps) {
  const details = toolDetails<{ kind: "image"; title?: string; data: string }>(
    block
  )
  if (!details.data)
    return <pre className="text-xs whitespace-pre-wrap">{block.output}</pre>
  return (
    <ShowContent
      details={{ kind: "image", data: details.data, title: details.title }}
    />
  )
}

for (const name of ["preview_screenshot", "browser_screenshot"]) {
  registerToolRenderer(name, {
    summary: (block) => {
      const title = toolDetails<{ title?: string }>(block).title
      return title ?? ""
    },
    Body: ImageResult,
  })
}

registerToolRenderer("browser_open", {
  summary: (block) => {
    const url = toolArgs(block).url
    return typeof url === "string" ? url : ""
  },
})

registerToolRenderer("browser_act", {
  summary: (block) => {
    const args = toolArgs(block)
    const target =
      typeof args.ref === "number"
        ? `[${args.ref}]`
        : typeof args.selector === "string"
          ? args.selector
          : typeof args.text === "string"
            ? `"${args.text}"`
            : ""
    const value = typeof args.value === "string" ? ` ${args.value}` : ""
    return `${typeof args.action === "string" ? args.action : ""} ${target}${value}`.trim()
  },
})

registerToolRenderer("notify", {
  summary: (block) => {
    const title = toolArgs(block).title
    return typeof title === "string" ? title : ""
  },
})
