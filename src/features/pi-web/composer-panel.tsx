import * as React from "react"
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderSearchIcon,
  HammerIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"

import type {
  ModelOption,
  PromptImage,
  SkillOption,
  StreamingBehavior,
} from "@/lib/pi-web"
import type { CompletionItem } from "@/lib/pi-web-api"

import type {
  ComposerCompletionQuery,
  SlashCommandDescriptor,
} from "@/features/pi-web/composer-utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  applyCompletionItem,
  formatComposerSkillName,
  getFileReferenceCompletionQuery,
  getPathCompletionQuery,
  matchingSlashCommands,
  parseSlashCommandInput,
  sameCompletionContext,
} from "@/features/pi-web/composer-utils"
import { promptImageKey } from "@/features/pi-web/conversation-view"
import { cn } from "@/lib/utils"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type WorkingState = {
  label: string
  summary?: string
  done?: boolean
}

export type ComposerPanelHandle = {
  focusPrompt: (options?: FocusOptions) => void
  openModelPicker: () => void
  openThinkingPicker: () => void
}

type ComposerPanelProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  composerImages: Array<PromptImage>
  composerText: string
  composerSkill?: string
  availableSkills: Array<SkillOption>
  availableModels: Array<ModelOption>
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  hideToolBlocks: boolean
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  isDraftSessionLoading: boolean
  hasPendingDraftPrompt: boolean
  workingState: WorkingState | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  slashCommands: Array<SlashCommandDescriptor>
  onComposerTextChange: (value: string) => void
  onSetComposerSkill: (skillName?: string) => void
  onPickImages: (files: FileList | null) => void
  onRemoveComposerImage: (index: number) => void
  onCreateSession: () => void
  onSubmitPrompt: (streamingBehavior?: StreamingBehavior) => void
  onAbort: () => void
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
  onRunBuiltinSlashCommand: (name: string, args: string) => void
  onSelectModel: (value: string) => void
  onSelectThinkingLevel: (level: string) => void
  onToggleHideToolBlocks: () => void
  requestPathCompletions: (prefix: string) => Promise<Array<CompletionItem>>
  requestFileCompletions: (
    query: string,
    isQuotedPrefix: boolean
  ) => Promise<Array<CompletionItem>>
}

type CompletionState = {
  query: ComposerCompletionQuery
  items: Array<CompletionItem>
  selectedIndex: number
}

function thinkingLabel(level: string) {
  switch (level) {
    case "off":
      return "Off"
    case "minimal":
      return "Minimal"
    case "low":
      return "Low"
    case "medium":
      return "Medium"
    case "high":
      return "High"
    case "xhigh":
      return "Extra High"
    default:
      return level
  }
}

function groupPendingMessages(messages: Array<PendingComposerMessage>) {
  return [
    {
      title: "Steer",
      items: messages.filter((message) => message.streamingBehavior === "steer"),
      emptyLabel: "Steer prompts will interrupt the current response.",
    },
    {
      title: "Queue",
      items: messages.filter((message) => message.streamingBehavior !== "steer"),
      emptyLabel: "Queued prompts will run after the current response.",
    },
  ]
}

function currentModelValue(model?: ModelOption) {
  return model ? `${model.provider}/${model.id}` : ""
}

function exactSlashCommand(
  value: string,
  commands: Array<SlashCommandDescriptor>
) {
  const parsed = parseSlashCommandInput(value)
  if (!parsed) return null

  const command = commands.find((entry) => entry.name === parsed.name)
  if (!command) return null

  return { command, args: parsed.args }
}

function visibleCompletionLabel(item: CompletionItem) {
  return item.label || item.value
}

function selectionIsAtStart(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return false
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  return start === 0 && end === 0
}

export const ComposerPanel = React.forwardRef<
  ComposerPanelHandle,
  ComposerPanelProps
>(function ComposerPanelImpl(
  {
    currentPendingMessages,
    composerImages,
    composerText,
    composerSkill,
    availableSkills,
    availableModels,
    model,
    thinkingLevel,
    availableThinkingLevels,
    hideToolBlocks,
    isSubmitting,
    isStreaming,
    awaitingFirstTurn,
    isDraftSessionLoading,
    hasPendingDraftPrompt,
    workingState,
    fileInputRef,
    slashCommands,
    onComposerTextChange,
    onSetComposerSkill,
    onPickImages,
    onRemoveComposerImage,
    onCreateSession,
    onSubmitPrompt,
    onAbort,
    onRemovePendingMessage,
    onReorderPending,
    onRunBuiltinSlashCommand,
    onSelectModel,
    onSelectThinkingLevel,
    onToggleHideToolBlocks,
    requestPathCompletions,
    requestFileCompletions,
  },
  ref
) {
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [selection, setSelection] = React.useState({
    start: composerText.length,
    end: composerText.length,
  })
  const [skillPickerOpen, setSkillPickerOpen] = React.useState(false)
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const [thinkingPickerOpen, setThinkingPickerOpen] = React.useState(false)
  const [modelQuery, setModelQuery] = React.useState("")
  const [skillQuery, setSkillQuery] = React.useState("")
  const [completionState, setCompletionState] = React.useState<CompletionState | null>(null)
  const completionRequestIdRef = React.useRef(0)
  const [slashSelectionIndex, setSlashSelectionIndex] = React.useState(0)

  React.useImperativeHandle(
    ref,
    () => ({
      focusPrompt: (options) => {
        promptRef.current?.focus(options)
      },
      openModelPicker: () => {
        setSkillPickerOpen(false)
        setThinkingPickerOpen(false)
        setModelPickerOpen(true)
      },
      openThinkingPicker: () => {
        setSkillPickerOpen(false)
        setModelPickerOpen(false)
        setThinkingPickerOpen(true)
      },
    }),
    []
  )

  const syncSelection = React.useCallback(() => {
    const textarea = promptRef.current
    if (!textarea) return
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    })
  }, [])

  const slashMenuState = React.useMemo(() => {
    if (composerSkill) return null

    const parsed = parseSlashCommandInput(composerText)
    if (!parsed || parsed.hasArguments) return null

    const commands = matchingSlashCommands(slashCommands, parsed.name)
    if (commands.length === 0) return null

    return {
      ...parsed,
      commands,
    }
  }, [composerSkill, composerText, slashCommands])

  React.useEffect(() => {
    setSlashSelectionIndex((current) => {
      if (!slashMenuState) return 0
      return Math.max(0, Math.min(slashMenuState.commands.length - 1, current))
    })
  }, [slashMenuState])

  const completionQuery = React.useMemo(() => {
    return (
      getFileReferenceCompletionQuery({
        value: composerText,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      }) ??
      getPathCompletionQuery({
        value: composerText,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      })
    )
  }, [composerText, selection.end, selection.start])

  React.useEffect(() => {
    if (!completionQuery) {
      setCompletionState((current) =>
        current && current.query.kind === "path" ? null : current
      )
      return
    }

    const requestId = ++completionRequestIdRef.current

    const load = async () => {
      try {
        const items =
          completionQuery.kind === "file-reference"
            ? await requestFileCompletions(
                completionQuery.rawPrefix,
                completionQuery.isQuotedPrefix
              )
            : await requestPathCompletions(completionQuery.prefix)

        if (requestId !== completionRequestIdRef.current) return

        const filteredItems = items.filter((item) => Boolean(item.value))
        if (filteredItems.length === 0) {
          setCompletionState((current) =>
            current && current.query.kind === completionQuery.kind ? null : current
          )
          return
        }

        setCompletionState((current) => {
          const selectedItem =
            current && sameCompletionContext(current.query, completionQuery)
              ? current.items[current.selectedIndex] || current.items[0]
              : null
          const selectedIndex = selectedItem
            ? Math.max(
                0,
                filteredItems.findIndex((item) => item.value === selectedItem.value)
              )
            : 0

          return {
            query: completionQuery,
            items: filteredItems,
            selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
          }
        })
      } catch {
        if (requestId === completionRequestIdRef.current) {
          setCompletionState((current) =>
            current && current.query.kind === completionQuery.kind ? null : current
          )
        }
      }
    }

    void load()
  }, [completionQuery, requestFileCompletions, requestPathCompletions])

  React.useEffect(() => {
    if (!modelPickerOpen) {
      setModelQuery("")
    }
  }, [modelPickerOpen])

  React.useEffect(() => {
    if (!skillPickerOpen) {
      setSkillQuery("")
    }
  }, [skillPickerOpen])

  const visibleCompletion = completionState?.items.length ? completionState : null
  const selectedCompletionItem = visibleCompletion
    ? visibleCompletion.items[visibleCompletion.selectedIndex] ||
      visibleCompletion.items[0]
    : null
  const selectedSlashCommand = slashMenuState
    ? slashMenuState.commands[slashSelectionIndex] || slashMenuState.commands[0]
    : null

  const filteredModels = React.useMemo(() => {
    const normalizedQuery = modelQuery.trim().toLowerCase()
    const nextModels = [...availableModels].sort(
      (left, right) =>
        (left.provider || "").localeCompare(right.provider || "") ||
        (left.name || left.id).localeCompare(right.name || right.id)
    )

    if (!normalizedQuery) return nextModels

    return nextModels.filter((entry) => {
      const haystack = `${entry.provider || ""} ${entry.name || ""} ${entry.id}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [availableModels, modelQuery])

  const groupedModels = React.useMemo(() => {
    const groups = new Map<string, Array<ModelOption>>()
    for (const entry of filteredModels) {
      const provider = entry.provider || "Models"
      const current = groups.get(provider) ?? []
      current.push(entry)
      groups.set(provider, current)
    }
    return [...groups.entries()]
  }, [filteredModels])

  const filteredSkills = React.useMemo(() => {
    const normalizedQuery = skillQuery.trim().toLowerCase()
    if (!normalizedQuery) return availableSkills

    return availableSkills.filter((entry) => {
      const haystack = `${entry.name} ${entry.description || ""} ${entry.scope || ""} ${entry.source || ""}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [availableSkills, skillQuery])

  const hasSubmittableContent =
    composerText.trim().length > 0 || composerImages.length > 0
  const acceptFollowUps = isStreaming || awaitingFirstTurn

  const setCaret = React.useCallback((start: number, end = start) => {
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(start, end)
      setSelection({ start, end })
    })
  }, [])

  const applyCompletion = React.useCallback(
    (item: CompletionItem, query = visibleCompletion?.query) => {
      if (!query) return false
      const next = applyCompletionItem({ value: composerText, query, item })
      onComposerTextChange(next.value)
      setCompletionState(null)
      setCaret(next.selectionStart, next.selectionEnd)
      return true
    },
    [composerText, onComposerTextChange, setCaret, visibleCompletion?.query]
  )

  const applySlashSuggestion = React.useCallback(
    (command: SlashCommandDescriptor | null) => {
      if (!command) return false

      if (command.kind === "skill") {
        onSetComposerSkill(command.skillName)
        onComposerTextChange("")
        requestAnimationFrame(() => promptRef.current?.focus())
        return true
      }

      const leadingWhitespace = composerText.match(/^\s*/)?.[0] || ""
      const nextValue = `${leadingWhitespace}/${command.name} `
      onComposerTextChange(nextValue)
      requestAnimationFrame(() => {
        promptRef.current?.focus()
        const nextCaret = nextValue.length
        promptRef.current?.setSelectionRange(nextCaret, nextCaret)
        setSelection({ start: nextCaret, end: nextCaret })
      })
      return true
    },
    [composerText, onComposerTextChange, onSetComposerSkill]
  )

  const runPrimaryComposerAction = React.useCallback(
    (streamingBehavior?: StreamingBehavior) => {
      const exact = exactSlashCommand(composerText, slashCommands)
      if (exact) {
        if (exact.command.kind === "builtin") {
          onRunBuiltinSlashCommand(exact.command.name, exact.args)
          return
        }

        if (!exact.args) {
          onSetComposerSkill(exact.command.skillName)
          onComposerTextChange("")
          return
        }
      }

      if (slashMenuState && selectedSlashCommand) {
        if (selectedSlashCommand.kind === "builtin") {
          onRunBuiltinSlashCommand(selectedSlashCommand.name, "")
          return
        }
        onSetComposerSkill(selectedSlashCommand.skillName)
        onComposerTextChange("")
        return
      }

      onSubmitPrompt(streamingBehavior)
    },
    [
      composerText,
      onComposerTextChange,
      onRunBuiltinSlashCommand,
      onSetComposerSkill,
      onSubmitPrompt,
      selectedSlashCommand,
      slashCommands,
      slashMenuState,
    ]
  )

  const dismissMenus = React.useCallback(() => {
    setCompletionState(null)
    setSlashSelectionIndex(0)
  }, [])

  const handleTextChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onComposerTextChange(event.target.value)
      setSelection({
        start: event.target.selectionStart,
        end: event.target.selectionEnd,
      })
    },
    [onComposerTextChange]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ctrlOrMeta = event.ctrlKey || event.metaKey

      if (event.key === "Backspace" && !composerText && composerSkill) {
        onSetComposerSkill(undefined)
        return
      }

      if (visibleCompletion && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault()
        setCompletionState((current) => {
          if (!current) return current
          const step = event.key === "ArrowDown" ? 1 : -1
          const total = current.items.length
          return {
            ...current,
            selectedIndex: (current.selectedIndex + step + total) % total,
          }
        })
        return
      }

      if (
        slashMenuState &&
        !visibleCompletion &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setSlashSelectionIndex((current) => {
          const total = slashMenuState.commands.length
          return (current + step + total) % total
        })
        return
      }

      if (ctrlOrMeta && !event.shiftKey && (event.key === "j" || event.key === "k")) {
        const direction = event.key === "j" ? 1 : -1
        if (visibleCompletion) {
          event.preventDefault()
          setCompletionState((current) => {
            if (!current) return current
            const total = current.items.length
            return {
              ...current,
              selectedIndex: (current.selectedIndex + direction + total) % total,
            }
          })
          return
        }

        if (slashMenuState) {
          event.preventDefault()
          setSlashSelectionIndex((current) => {
            const total = slashMenuState.commands.length
            return (current + direction + total) % total
          })
        }
      }

      if (event.key === "Tab") {
        if (visibleCompletion && selectedCompletionItem) {
          event.preventDefault()
          applyCompletion(selectedCompletionItem)
          return
        }
        if (slashMenuState && selectedSlashCommand) {
          event.preventDefault()
          applySlashSuggestion(selectedSlashCommand)
          return
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if (visibleCompletion && selectedCompletionItem) {
          event.preventDefault()
          applyCompletion(selectedCompletionItem)
          return
        }

        if (ctrlOrMeta) {
          event.preventDefault()
          runPrimaryComposerAction(
            event.altKey ? "followUp" : acceptFollowUps ? "steer" : undefined
          )
          return
        }
      }

      if (event.key === "Escape") {
        if (visibleCompletion || slashMenuState) {
          dismissMenus()
          return
        }
      }

      if (
        event.key === "ArrowUp" &&
        !visibleCompletion &&
        !slashMenuState &&
        !composerText &&
        composerSkill &&
        selectionIsAtStart(promptRef.current)
      ) {
        onSetComposerSkill(undefined)
      }
    },
    [
      acceptFollowUps,
      applyCompletion,
      applySlashSuggestion,
      composerSkill,
      composerText,
      dismissMenus,
      onSetComposerSkill,
      runPrimaryComposerAction,
      selectedCompletionItem,
      selectedSlashCommand,
      slashMenuState,
      visibleCompletion,
    ]
  )

  const primaryButtonLabel = React.useMemo(() => {
    if (isStreaming && !hasSubmittableContent) {
      return "Stop"
    }
    if (hasPendingDraftPrompt && isDraftSessionLoading) {
      return "Send when ready"
    }
    if (acceptFollowUps) {
      return "Steer"
    }
    return "Send"
  }, [acceptFollowUps, hasPendingDraftPrompt, hasSubmittableContent, isDraftSessionLoading, isStreaming])

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        {currentPendingMessages.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/15 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderSearchIcon className="text-muted-foreground" />
                Pending prompts
              </div>
              <Badge variant="outline">{currentPendingMessages.length}</Badge>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {groupPendingMessages(currentPendingMessages).map((section) => (
                <div key={section.title} className="flex flex-col gap-2 rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>{section.title}</span>
                    <span>{section.items.length}</span>
                  </div>
                  {section.items.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {section.items.map((message, index) => (
                        <div
                          key={message.pendingId}
                          className="rounded-md border bg-muted/25 p-2.5"
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">
                              {message.streamingBehavior === "steer"
                                ? "Steer"
                                : "Follow-up"}
                            </Badge>
                            <span className="min-w-0 flex-1 truncate">
                              {message.pendingId}
                            </span>
                          </div>
                          <div className="line-clamp-3 text-sm">
                            {message.text || "Queued image prompt"}
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={index === 0}
                              onClick={() => onReorderPending(message.pendingId, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={index === section.items.length - 1}
                              onClick={() => onReorderPending(message.pendingId, 1)}
                            >
                              ↓
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => onRemovePendingMessage(message.pendingId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                      {section.emptyLabel}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {workingState ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
              workingState.done
                ? "border-emerald-500/20 bg-emerald-500/8"
                : "border-primary/20 bg-primary/8"
            )}
          >
            {workingState.done ? <CheckIcon className="mt-0.5 text-emerald-600" /> : <Spinner className="mt-0.5" />}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{workingState.label}</div>
              {workingState.summary ? (
                <div className="mt-1 text-muted-foreground">
                  {workingState.summary}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {composerSkill ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <SparklesIcon className="text-muted-foreground" />
              <span className="truncate font-medium">
                Skill: {formatComposerSkillName(composerSkill)}
              </span>
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove skill ${formatComposerSkillName(composerSkill)}`}
              onClick={() => onSetComposerSkill(undefined)}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}

        {composerImages.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {composerImages.map((image, index) => (
              <div key={promptImageKey(image)} className="relative">
                <img
                  src={image.previewUrl}
                  alt="Attachment preview"
                  className="h-24 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow-sm"
                  onClick={() => onRemoveComposerImage(index)}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Popover open={skillPickerOpen} onOpenChange={setSkillPickerOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <SparklesIcon data-icon="inline-start" />
              {composerSkill ? formatComposerSkillName(composerSkill) : "Skills"}
              <ChevronDownIcon data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" side="top" align="start">
              <Command>
                <CommandInput
                  value={skillQuery}
                  onValueChange={setSkillQuery}
                  placeholder="Search skills"
                />
                <CommandList>
                  <CommandEmpty>No skills match your search.</CommandEmpty>
                  <CommandGroup heading="Available skills">
                    {filteredSkills.map((skill) => (
                      <CommandItem
                        key={skill.name}
                        value={`${skill.name} ${skill.description || ""} ${skill.scope || ""}`}
                        onSelect={() => {
                          onSetComposerSkill(skill.name)
                          setSkillPickerOpen(false)
                          requestAnimationFrame(() => promptRef.current?.focus())
                        }}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">
                            {formatComposerSkillName(skill.name)}
                          </span>
                          {skill.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {skill.description}
                            </span>
                          ) : null}
                        </div>
                        {composerSkill === skill.name ? <CheckIcon /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <SearchIcon data-icon="inline-start" />
              {model?.name || "Select model"}
              <ChevronDownIcon data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent className="w-88 p-0" side="top" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  value={modelQuery}
                  onValueChange={setModelQuery}
                  placeholder="Search models"
                />
                <CommandList>
                  <CommandEmpty>No models match your search.</CommandEmpty>
                  {groupedModels.map(([provider, items]) => (
                    <CommandGroup key={provider} heading={provider}>
                      {items.map((entry) => {
                        const value = `${entry.provider}/${entry.id}`
                        const active = value === currentModelValue(model)
                        return (
                          <CommandItem
                            key={value}
                            value={`${entry.provider || ""} ${entry.name || entry.id} ${entry.id}`}
                            onSelect={() => {
                              onSelectModel(value)
                              setModelPickerOpen(false)
                            }}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate font-medium">
                                {entry.name || entry.id}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {entry.provider}/{entry.id}
                              </span>
                            </div>
                            {active ? <CheckIcon /> : null}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Popover open={thinkingPickerOpen} onOpenChange={setThinkingPickerOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <BrainIcon data-icon="inline-start" />
              {thinkingLabel(thinkingLevel)}
              <ChevronDownIcon data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" side="top" align="start">
              <Command>
                <CommandList>
                  <CommandGroup heading="Reasoning">
                    {availableThinkingLevels.map((level) => (
                      <CommandItem
                        key={level}
                        value={level}
                        onSelect={() => {
                          onSelectThinkingLevel(level)
                          setThinkingPickerOpen(false)
                        }}
                      >
                        <span className="flex-1">{thinkingLabel(level)}</span>
                        {thinkingLevel === level ? <CheckIcon /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button variant="ghost" size="sm" onClick={onToggleHideToolBlocks}>
            <HammerIcon data-icon="inline-start" />
            {hideToolBlocks ? "Show tools" : "Hide tools"}
          </Button>
        </div>

        <div className="relative flex flex-col gap-2">
          {visibleCompletion || slashMenuState ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
              <div className="max-h-64 overflow-y-auto">
                {visibleCompletion ? (
                  <div className="flex flex-col gap-1">
                    {visibleCompletion.items.map((item, index) => {
                      const selected = index === visibleCompletion.selectedIndex
                      return (
                        <button
                          key={`${item.value}:${item.description || item.label}`}
                          type="button"
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                            selected ? "bg-muted" : "hover:bg-muted/70"
                          )}
                          onMouseEnter={() => {
                            setCompletionState((current) =>
                              current ? { ...current, selectedIndex: index } : current
                            )
                          }}
                          onClick={() => {
                            applyCompletion(item)
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {visibleCompletionLabel(item)}
                            </span>
                            {item.description ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.description}
                              </span>
                            ) : null}
                          </span>
                          {selected ? <CheckIcon className="mt-0.5 shrink-0" /> : null}
                        </button>
                      )
                    })}
                    <Separator />
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      {visibleCompletion.query.kind === "file-reference"
                        ? "@ file references"
                        : "Path suggestions"}
                    </div>
                  </div>
                ) : slashMenuState ? (
                  <div className="flex flex-col gap-1">
                    {slashMenuState.commands.map((command, index) => {
                      const selected = index === slashSelectionIndex
                      return (
                        <button
                          key={command.name}
                          type="button"
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                            selected ? "bg-muted" : "hover:bg-muted/70"
                          )}
                          onMouseEnter={() => {
                            setSlashSelectionIndex(index)
                          }}
                          onClick={() => {
                            applySlashSuggestion(command)
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              /{command.name}
                            </span>
                            {command.description ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {command.description}
                              </span>
                            ) : null}
                          </span>
                          {selected ? <CheckIcon className="mt-0.5 shrink-0" /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <Textarea
            ref={promptRef}
            value={composerText}
            onChange={handleTextChange}
            onClick={syncSelection}
            onKeyUp={syncSelection}
            onSelect={syncSelection}
            onKeyDown={handleKeyDown}
            placeholder={
              acceptFollowUps
                ? "Write a steer or follow-up message…"
                : composerSkill
                  ? `Ask with ${formatComposerSkillName(composerSkill)}…`
                  : "Ask Pi to Go anything…"
            }
            className="min-h-28 resize-y"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => onPickImages(event.target.files)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlusIcon data-icon="inline-start" />
              Add images
            </Button>
            <Button variant="outline" size="sm" onClick={onCreateSession}>
              <PlusIcon data-icon="inline-start" />
              New session
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {acceptFollowUps ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting || !hasSubmittableContent}
                  onClick={() => onSubmitPrompt("followUp")}
                >
                  Queue follow-up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting || !hasSubmittableContent}
                  onClick={() => onSubmitPrompt("steer")}
                >
                  Steer now
                </Button>
              </>
            ) : null}
            {(isStreaming || awaitingFirstTurn || isDraftSessionLoading) && (
              <Button variant="outline" size="sm" onClick={onAbort}>
                Abort
              </Button>
            )}
            <Button
              disabled={
                isSubmitting ||
                (!hasSubmittableContent && !isStreaming && !slashMenuState)
              }
              onClick={() => {
                if (isStreaming && !hasSubmittableContent) {
                  onAbort()
                  return
                }
                runPrimaryComposerAction(
                  acceptFollowUps ? "steer" : undefined
                )
              }}
            >
              {isSubmitting ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              {primaryButtonLabel}
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Cmd/Ctrl+Enter sends or steers. Alt+Cmd/Ctrl+Enter queues a follow-up.
          Use ↑/↓ or Ctrl+J/K for suggestions, Tab to accept slash/path picks,
          and Enter to accept file/path completions.
        </div>
      </CardContent>
    </Card>
  )
})
