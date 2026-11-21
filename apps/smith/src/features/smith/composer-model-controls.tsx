import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"

import type { AgentState } from "@/lib/smith"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TitleTooltip } from "@/components/ui/tooltip"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/smith/keyboard-shortcuts"
import { shortModelLabel, thinkingLabel } from "@/features/smith/model-label"
import {
  shallow,
  useSelector,
  type SmithStore,
} from "@/features/smith/tanstack-store-utils"
import { emitSmithEvent } from "@/features/smith/agent/events"
import {
  ContextUsageSeparateRings,
  ContextUsageQuotaDetails,
  ContextUsageRings,
  ContextUsageWindowDetails,
  useContextUsageView,
  type ComposerContextUsageStore,
} from "@/features/smith/context-usage"
import { useMachineReadOnly } from "@/features/smith/machine-store"
import { smithQueryKeys } from "@/features/smith/query-keys"
import { cn } from "@/lib/utils"

/** The model and reasoning buttons of the composer. */
export const ComposerModelControls = React.memo(function ComposerModelControls({
  agentStore,
  disabled,
  onOpenModelDialog,
  onSelectThinkingLevel,
}: {
  agentStore: SmithStore<AgentState>
  disabled: boolean
  onOpenModelDialog: () => void
  onSelectThinkingLevel: (level: string) => void
}) {
  const { label, thinkingLevel, availableThinkingLevels } = useSelector(
    agentStore,
    (state) => ({
      label: shortModelLabel(state.model, state.availableModels),
      thinkingLevel: state.thinkingLevel,
      availableThinkingLevels: state.availableThinkingLevels,
    }),
    { compare: shallow }
  )

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <TitleTooltip title="Model" kbd={formatShortcutLabel(appShortcut("M"))}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="max-w-40 min-w-0 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={`Model: ${label}`}
          disabled={disabled}
          onClick={onOpenModelDialog}
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </TitleTooltip>

      {availableThinkingLevels.length > 0 ? (
        <DropdownMenu>
          <TitleTooltip
            title="Reasoning"
            kbd={`${formatShortcutLabel(appShortcut("R"))} / ${formatShortcutLabel(appShortcut("Shift+R"))}`}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={`Reasoning: ${thinkingLabel(thinkingLevel)}`}
                  disabled={disabled}
                />
              }
            >
              <span className="truncate">{thinkingLabel(thinkingLevel)}</span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
          </TitleTooltip>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={thinkingLevel}
                onValueChange={(level: string) => {
                  if (disabled) return
                  onSelectThinkingLevel(level)
                }}
              >
                {availableThinkingLevels.map((level) => (
                  <DropdownMenuRadioItem key={level} value={level}>
                    {thinkingLabel(level)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
})

/**
 * The context ring of the composer, with the 5h and weekly usage rings when
 * the provider tells them. Its menu shows the usage details. It is not shown
 * when the agent has no usage yet.
 */
export const ComposerContextUsage = React.memo(function ComposerContextUsage({
  activeAgentId,
  agentStore,
  contextUsageStore,
  viewerContextId,
}: {
  activeAgentId?: string
  agentStore: SmithStore<AgentState>
  contextUsageStore: ComposerContextUsageStore
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const machineReadOnly = useMachineReadOnly()
  const modelProvider = useSelector(
    agentStore,
    (state) => state.model?.provider
  )
  const view = useContextUsageView({
    activeAgentId,
    contextUsageStore,
    disabled: machineReadOnly,
    modelProvider,
    viewerContextId,
  })
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const separateRef = React.useRef<HTMLSpanElement>(null)
  const compactRef = React.useRef<HTMLSpanElement>(null)
  const fit = useSeparateRingsFit(
    triggerRef,
    separateRef,
    compactRef,
    view?.rings.length ?? 0
  )
  const separateFits = fit !== "merged"
  if (!view) return null

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // The session and weekly usage change with each request, so the
        // menu gets them again when it opens.
        if (open)
          void queryClient.invalidateQueries({
            queryKey: smithQueryKeys.providerUsageAll(),
          })
      }}
    >
      <TitleTooltip
        title={
          view.percent == null
            ? "Context usage"
            : `${view.displayPercent} of the context used`
        }
        // The labeled rings say the same, so the tooltip shows only for the
        // merged rings, where the row has no room for the labels.
        openWhen={() => fit !== "labeled"}
      >
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              ref={triggerRef}
              // Separate labeled rings when they fit in the row below the
              // composer (also on a phone), merged rings when they do not.
              className={cn(
                "relative h-7 shrink-0 cursor-pointer",
                separateFits ? "px-2" : "px-0"
              )}
              aria-label={view.ariaLabel}
            />
          }
        >
          {separateFits ? null : (
            <ContextUsageRings view={view} className="size-7" />
          )}
          {/* Both always rendered, so their widths can be measured; out of
              the layout and invisible while not chosen. */}
          <ContextUsageSeparateRings
            ref={separateRef}
            view={view}
            className={fit === "labeled" ? "flex" : MEASURE_ONLY}
          />
          <ContextUsageSeparateRings
            ref={compactRef}
            view={view}
            labels={false}
            className={fit === "compact" ? "flex" : MEASURE_ONLY}
          />
        </DropdownMenuTrigger>
      </TitleTooltip>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuItem
          className="block"
          onClick={() =>
            emitSmithEvent("smith:open-agent-settings", {
              page: "agent-context",
            })
          }
        >
          <ContextUsageWindowDetails view={view} />
        </DropdownMenuItem>
        <ContextUsageQuotaDetails view={view} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

const MEASURE_ONLY = "invisible absolute top-0 left-0 flex"

/**
 * How the usage rings fit in the row of the composer controls: separate
 * with labels, separate without labels, or merged into one. It compares the
 * row width less the other controls with the natural widths of the two
 * separate forms (plus the trigger padding).
 */
function useSeparateRingsFit(
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  labeledRef: React.RefObject<HTMLSpanElement | null>,
  compactRef: React.RefObject<HTMLSpanElement | null>,
  ringCount: number
) {
  const [fit, setFit] = React.useState<"labeled" | "compact" | "merged">(
    "merged"
  )
  React.useLayoutEffect(() => {
    const trigger = triggerRef.current
    const labeled = labeledRef.current
    const compact = compactRef.current
    const row = trigger?.parentElement
    if (!trigger || !labeled || !compact || !row) return
    const measure = () => {
      const style = getComputedStyle(row)
      const gap = parseFloat(style.columnGap) || 0
      let others = 0
      let count = 0
      for (const child of Array.from(row.children)) {
        if (child === trigger || !(child instanceof HTMLElement)) continue
        others += child.getBoundingClientRect().width
        count += 1
      }
      const available =
        row.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0) -
        others -
        gap * count
      // 16 px: the trigger's padding when it shows separate rings.
      setFit(
        labeled.scrollWidth + 16 <= available
          ? "labeled"
          : compact.scrollWidth + 16 <= available
            ? "compact"
            : "merged"
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(labeled)
    observer.observe(compact)
    return () => observer.disconnect()
  }, [triggerRef, labeledRef, compactRef, ringCount])
  return fit
}
