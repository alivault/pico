import * as React from "react"
import {
  ArrowUpIcon,
  CheckIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react"

import type {
  ModelOption,
  PromptImage,
  SessionState,
  StreamingBehavior,
} from "@/lib/pi-web"
import type { CompletionItem } from "@/lib/pi-web-api"

import type {
  ComposerCompletionQuery,
  SlashCommandDescriptor,
} from "@/features/pi-web/composer-utils"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ComposerPendingMessages } from "@/features/pi-web/composer-pending-messages"
import { ComposerPickers } from "@/features/pi-web/composer-pickers"
import {
  applyCompletionItem,
  formatComposerSkillName,
  getFileReferenceCompletionQuery,
  getPathCompletionQuery,
  matchingSlashCommands,
  parseComposerSkillMessage,
  parseSlashCommandInput,
  sameCompletionContext,
  serializeComposerDraft,
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
  availableModels: Array<ModelOption>
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  contextUsage?: SessionState["contextUsage"]
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  workingState: WorkingState | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  slashCommands: Array<SlashCommandDescriptor>
  onComposerTextChange: (value: string) => void
  onPickImages: (files: FileList | null) => void
  onRemoveComposerImage: (index: number) => void
  onSubmitPrompt: (streamingBehavior?: StreamingBehavior) => void
  onAbort: () => void
  onRemovePendingMessage: (pendingId: string) => void
  onReorderPending: (pendingId: string, direction: -1 | 1) => void
  onRunBuiltinSlashCommand: (name: string, args: string) => void
  onSelectModel: (value: string) => void
  onSelectThinkingLevel: (level: string) => void
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
    availableModels,
    model,
    thinkingLevel,
    availableThinkingLevels,
    contextUsage,
    isSubmitting,
    isStreaming,
    awaitingFirstTurn,
    fileInputRef,
    slashCommands,
    onComposerTextChange,
    onPickImages,
    onRemoveComposerImage,
    onSubmitPrompt,
    onAbort,
    onRemovePendingMessage,
    onReorderPending,
    onRunBuiltinSlashCommand,
    onSelectModel,
    onSelectThinkingLevel,
    requestPathCompletions,
    requestFileCompletions,
  },
  ref
) {
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [draftText, setDraftText] = React.useState(composerText)
  const [draftSkill, setDraftSkill] = React.useState(composerSkill)
  const [selection, setSelection] = React.useState({
    start: composerText.length,
    end: composerText.length,
  })
  const draftSyncTimeoutRef = React.useRef<number | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const [thinkingPickerOpen, setThinkingPickerOpen] = React.useState(false)
  const [modelQuery, setModelQuery] = React.useState("")
  const [completionState, setCompletionState] =
    React.useState<CompletionState | null>(null)
  const completionRequestIdRef = React.useRef(0)
  const [slashSelectionIndex, setSlashSelectionIndex] = React.useState(0)

  const syncDraftToParent = (text: string, skillName?: string) => {
    onComposerTextChange(serializeComposerDraft({ text, skillName }))
  }

  const scheduleDraftSync = (text: string, skillName?: string) => {
    if (draftSyncTimeoutRef.current != null) {
      window.clearTimeout(draftSyncTimeoutRef.current)
    }

    draftSyncTimeoutRef.current = window.setTimeout(() => {
      draftSyncTimeoutRef.current = null
      syncDraftToParent(text, skillName)
    }, 120)
  }

  const applyDraft = (
    text: string,
    skillName?: string,
    options?: {
      immediate?: boolean
    }
  ) => {
    setDraftText(text)
    setDraftSkill(skillName)

    if (options?.immediate) {
      if (draftSyncTimeoutRef.current != null) {
        window.clearTimeout(draftSyncTimeoutRef.current)
        draftSyncTimeoutRef.current = null
      }
      syncDraftToParent(text, skillName)
      return
    }

    scheduleDraftSync(text, skillName)
  }

  React.useEffect(() => {
    setDraftText(composerText)
    setDraftSkill(composerSkill)
    setSelection({ start: composerText.length, end: composerText.length })
    setCompletionState(null)
    setSlashSelectionIndex(0)
  }, [composerSkill, composerText])

  React.useEffect(() => {
    return () => {
      if (draftSyncTimeoutRef.current != null) {
        window.clearTimeout(draftSyncTimeoutRef.current)
      }
    }
  }, [])

  React.useImperativeHandle(
    ref,
    () => ({
      focusPrompt: (options) => {
        promptRef.current?.focus(options)
      },
      openModelPicker: () => {
        setThinkingPickerOpen(false)
        setModelPickerOpen(true)
      },
      openThinkingPicker: () => {
        setModelPickerOpen(false)
        setThinkingPickerOpen(true)
      },
    }),
    []
  )

  const syncSelection = () => {
    const textarea = promptRef.current
    if (!textarea) return
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    })
  }

  const slashMenuState = (() => {
    if (draftSkill) return null

    const parsed = parseSlashCommandInput(draftText)
    if (!parsed || parsed.hasArguments) return null

    const commands = matchingSlashCommands(slashCommands, parsed.name)
    if (commands.length === 0) return null

    return {
      ...parsed,
      commands,
    }
  })()

  React.useEffect(() => {
    setSlashSelectionIndex((current) => {
      if (!slashMenuState) return 0
      return Math.max(0, Math.min(slashMenuState.commands.length - 1, current))
    })
  }, [slashMenuState])

  const completionQuery = (() => {
    return (
      getFileReferenceCompletionQuery({
        value: draftText,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      }) ??
      getPathCompletionQuery({
        value: draftText,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      })
    )
  })()

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
            current && current.query.kind === completionQuery.kind
              ? null
              : current
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
                filteredItems.findIndex(
                  (item) => item.value === selectedItem.value
                )
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
            current && current.query.kind === completionQuery.kind
              ? null
              : current
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

  const visibleCompletion = completionState?.items.length
    ? completionState
    : null
  const selectedCompletionItem = visibleCompletion
    ? visibleCompletion.items[visibleCompletion.selectedIndex] ||
      visibleCompletion.items[0]
    : null
  const selectedSlashCommand = slashMenuState
    ? slashMenuState.commands[slashSelectionIndex] || slashMenuState.commands[0]
    : null

  const hasSubmittableContent =
    draftText.trim().length > 0 || composerImages.length > 0
  const acceptFollowUps = isStreaming || awaitingFirstTurn

  const setCaret = (start: number, end = start) => {
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(start, end)
      setSelection({ start, end })
    })
  }

  const applyCompletion = (
    item: CompletionItem,
    query = visibleCompletion?.query
  ) => {
    if (!query) return false
    const next = applyCompletionItem({ value: draftText, query, item })
    const parsed = parseComposerSkillMessage(next.value)
    applyDraft(
      parsed.matched ? parsed.text : next.value,
      parsed.matched ? parsed.skillName : undefined
    )
    setCompletionState(null)
    setCaret(next.selectionStart, next.selectionEnd)
    return true
  }

  const applySlashSuggestion = (command: SlashCommandDescriptor | null) => {
    if (!command) return false

    if (command.kind === "skill") {
      applyDraft("", command.skillName, { immediate: true })
      requestAnimationFrame(() => promptRef.current?.focus())
      return true
    }

    const leadingWhitespace = draftText.match(/^\s*/)?.[0] || ""
    const nextValue = `${leadingWhitespace}/${command.name} `
    applyDraft(nextValue)
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      const nextCaret = nextValue.length
      promptRef.current?.setSelectionRange(nextCaret, nextCaret)
      setSelection({ start: nextCaret, end: nextCaret })
    })
    return true
  }

  const runPrimaryComposerAction = (streamingBehavior?: StreamingBehavior) => {
    const exact = exactSlashCommand(draftText, slashCommands)
    if (exact) {
      if (exact.command.kind === "builtin") {
        onRunBuiltinSlashCommand(exact.command.name, exact.args)
        return
      }

      if (!exact.args) {
        applyDraft("", exact.command.skillName, { immediate: true })
        return
      }
    }

    if (slashMenuState && selectedSlashCommand) {
      if (selectedSlashCommand.kind === "builtin") {
        onRunBuiltinSlashCommand(selectedSlashCommand.name, "")
        return
      }
      applyDraft("", selectedSlashCommand.skillName, { immediate: true })
      return
    }

    syncDraftToParent(draftText, draftSkill)
    onSubmitPrompt(streamingBehavior)
  }

  const dismissMenus = () => {
    setCompletionState(null)
    setSlashSelectionIndex(0)
  }

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const parsed = parseComposerSkillMessage(event.target.value)
    applyDraft(
      parsed.matched ? parsed.text : event.target.value,
      parsed.matched ? parsed.skillName : undefined
    )
    setSelection({
      start: event.target.selectionStart,
      end: event.target.selectionEnd,
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrlShortcut = event.ctrlKey && !event.metaKey
    const cmdSendShortcut =
      event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey

    if (event.key === "Backspace" && !draftText && draftSkill) {
      applyDraft("", undefined, { immediate: true })
      return
    }

    if (
      visibleCompletion &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
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

    if (
      ctrlShortcut &&
      !event.shiftKey &&
      (event.key === "j" || event.key === "k")
    ) {
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

      if (ctrlShortcut || cmdSendShortcut) {
        event.preventDefault()
        runPrimaryComposerAction(
          ctrlShortcut && event.altKey
            ? "followUp"
            : acceptFollowUps
              ? "steer"
              : undefined
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
      !draftText &&
      draftSkill &&
      selectionIsAtStart(promptRef.current)
    ) {
      applyDraft("", undefined, { immediate: true })
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <ComposerPendingMessages
        currentPendingMessages={currentPendingMessages}
        onRemovePendingMessage={onRemovePendingMessage}
        onReorderPending={onReorderPending}
      />

      <div className="overflow-visible rounded-[18px] border bg-card">
        <div className="relative overflow-visible rounded-t-[18px] border-b border-border/70 bg-card px-3 py-3">
          <div className="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2">
            {visibleCompletion || slashMenuState ? (
              <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
                <div className="max-h-64 overflow-y-auto">
                  {visibleCompletion ? (
                    <div className="flex flex-col gap-1">
                      {visibleCompletion.items.map((item, index) => {
                        const selected =
                          index === visibleCompletion.selectedIndex
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
                                current
                                  ? { ...current, selectedIndex: index }
                                  : current
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
                            {selected ? (
                              <CheckIcon className="mt-0.5 shrink-0" />
                            ) : null}
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
                            {selected ? (
                              <CheckIcon className="mt-0.5 shrink-0" />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="icon-sm"
              title="Add images"
              aria-label="Add images"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlusIcon />
            </Button>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {draftSkill ? (
                  <span className="inline-flex h-6 max-w-[45%] shrink-0 items-center gap-0 overflow-hidden rounded-full bg-primary/10 pr-0.5 pl-2 text-sm font-medium text-primary">
                    <span className="truncate">
                      Skill: {formatComposerSkillName(draftSkill)}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="ml-1 rounded-full text-primary hover:bg-primary/10 hover:text-primary"
                      aria-label={`Remove skill ${formatComposerSkillName(draftSkill)}`}
                      onClick={() =>
                        applyDraft(draftText, undefined, { immediate: true })
                      }
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </span>
                ) : null}

                <Textarea
                  ref={promptRef}
                  name="prompt"
                  rows={1}
                  value={draftText}
                  onChange={handleTextChange}
                  onClick={syncSelection}
                  onKeyUp={syncSelection}
                  onSelect={syncSelection}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    acceptFollowUps
                      ? "Write a steer or follow-up message…"
                      : draftSkill
                        ? `Ask with ${formatComposerSkillName(draftSkill)}…`
                        : "Ask anything…"
                  }
                  className="min-h-[22px] flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                />
              </div>
            </div>

            <Button
              size="icon-sm"
              disabled={
                isSubmitting ||
                (!hasSubmittableContent && !isStreaming && !slashMenuState)
              }
              title="Send"
              aria-label="Send"
              onClick={() => {
                if (isStreaming && !hasSubmittableContent) {
                  onAbort()
                  return
                }
                runPrimaryComposerAction(acceptFollowUps ? "steer" : undefined)
              }}
            >
              {isSubmitting ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <ArrowUpIcon />
              )}
            </Button>
          </div>

          {composerImages.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {composerImages.map((image, index) => (
                <div key={promptImageKey(image)} className="relative">
                  <img
                    src={image.previewUrl}
                    alt="Attachment preview"
                    className="h-20 w-20 rounded-lg border object-cover"
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

          {acceptFollowUps ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting || !hasSubmittableContent}
                onClick={() => onSubmitPrompt("followUp")}
              >
                Queue
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmitting || !hasSubmittableContent}
                onClick={() => onSubmitPrompt("steer")}
              >
                Steer
              </Button>
              {isStreaming ? (
                <Button variant="outline" size="sm" onClick={onAbort}>
                  Abort
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <ComposerPickers
          modelPickerOpen={modelPickerOpen}
          onModelPickerOpenChange={setModelPickerOpen}
          thinkingPickerOpen={thinkingPickerOpen}
          onThinkingPickerOpenChange={setThinkingPickerOpen}
          modelQuery={modelQuery}
          onModelQueryChange={setModelQuery}
          availableModels={availableModels}
          model={model}
          thinkingLevel={thinkingLevel}
          availableThinkingLevels={availableThinkingLevels}
          contextUsage={contextUsage}
          onSelectModel={onSelectModel}
          onSelectThinkingLevel={onSelectThinkingLevel}
        />
      </div>

      <input
        ref={fileInputRef}
        name="images"
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => onPickImages(event.target.files)}
      />
    </div>
  )
})
