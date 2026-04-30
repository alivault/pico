import * as React from "react"
import {
  ArrowUpIcon,
  ImagePlusIcon,
  ListEndIcon,
  ListStartIcon,
  LoaderCircleIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import type { PromptImage, SessionState, StreamingBehavior } from "@/lib/phi"
import type { CompletionItem } from "@/lib/phi/api"

import type { SlashCommandDescriptor } from "@/features/phi/composer-utils"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ComposerAssistMenu } from "@/features/phi/composer-assist-menu"
import { ComposerPendingMessages } from "@/features/phi/composer-pending-messages"
import { ComposerPickers } from "@/features/phi/composer-pickers"
import type { ComposerContextUsageStore } from "@/features/phi/composer-context-usage-indicator"
import {
  formatComposerSkillName,
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/phi/composer-utils"
import { promptImageKey } from "@/features/phi/conversation-view"
import {
  findExactSlashCommand,
  useComposerAssist,
} from "@/features/phi/use-composer-assist"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

export type ComposerPanelHandle = {
  focusPrompt: (options?: FocusOptions) => void
  openModelPicker: () => void
  openThinkingPicker: () => void
}

type ImageFileSelection = FileList | Array<File> | null

type ComposerSessionStore = {
  getSnapshot: () => SessionState
  subscribe: (listener: () => void) => () => void
}

type ComposerDisplaySettingsStore = {
  getSnapshot: () => { hideToolBlocks: boolean }
  subscribe: (listener: () => void) => () => void
}

type ComposerPanelProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  composerImages: Array<PromptImage>
  composerText: string
  composerSkill?: string
  composerSyncNonce: number
  centerMessages: boolean
  contextUsageStore: ComposerContextUsageStore
  displaySettingsStore: ComposerDisplaySettingsStore
  sessionStore: ComposerSessionStore
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  disabled?: boolean
  flush?: boolean
  topContent?: React.ReactNode
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onComposerTextChange: (value: string) => void
  onPickImages: (files: ImageFileSelection) => void
  onRemoveComposerImage: (index: number) => void
  onSubmitPrompt: (streamingBehavior?: StreamingBehavior) => void
  onAbort: () => void
  onEditPendingMessage: (pendingId: string, text: string) => void
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

type ComposerAttachmentsProps = {
  images: Array<PromptImage>
  disabled: boolean
  onRemoveImage: (index: number) => void
}

type ComposerPromptEditorProps = {
  composerImages: Array<PromptImage>
  composerText: string
  composerSkill?: string
  composerSyncNonce: number
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  disabled?: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  promptRef: React.RefObject<HTMLTextAreaElement | null>
  displaySettingsStore: ComposerDisplaySettingsStore
  sessionStore: ComposerSessionStore
  onComposerTextChange: (value: string) => void
  onPickImages: (files: ImageFileSelection) => void
  onRemoveComposerImage: (index: number) => void
  onSubmitPrompt: (streamingBehavior?: StreamingBehavior) => void
  onAbort: () => void
  onRunBuiltinSlashCommand: (name: string, args: string) => void
  requestPathCompletions: (prefix: string) => Promise<Array<CompletionItem>>
  requestFileCompletions: (
    query: string,
    isQuotedPrefix: boolean
  ) => Promise<Array<CompletionItem>>
}

function selectionIsAtStart(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return false
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  return start === 0 && end === 0
}

function buildComposerSlashCommands({
  availableSkills,
  hideThinkingBlock,
  hideToolBlocks,
}: {
  availableSkills: SessionState["availableSkills"]
  hideThinkingBlock: boolean
  hideToolBlocks: boolean
}) {
  return [
    {
      kind: "builtin" as const,
      name: "compact",
      description: "Summarize the session to reduce context size",
    },
    {
      kind: "builtin" as const,
      name: "delete",
      description: "Delete the current session",
    },
    {
      kind: "builtin" as const,
      name: "fork",
      description: "Create a new session from a previous message",
    },
    {
      kind: "builtin" as const,
      name: "tree",
      description: "Navigate to an earlier point in the current session tree",
    },
    {
      kind: "builtin" as const,
      name: "rename",
      description: "Rename the current session",
    },
    ...(hideThinkingBlock
      ? [
          {
            kind: "builtin" as const,
            name: "show-thinking",
            description: "Show assistant thinking blocks",
          },
        ]
      : [
          {
            kind: "builtin" as const,
            name: "hide-thinking",
            description: "Hide assistant thinking blocks",
          },
        ]),
    ...(hideToolBlocks
      ? [
          {
            kind: "builtin" as const,
            name: "show-tools",
            description: "Show assistant tool calls",
          },
        ]
      : [
          {
            kind: "builtin" as const,
            name: "hide-tools",
            description: "Hide assistant tool calls",
          },
        ]),
    ...availableSkills.map((skill) => ({
      kind: "skill" as const,
      name: `skill:${skill.name}` as const,
      skillName: skill.name,
      description: skill.description || "Use this skill",
      scope: skill.scope,
      source: skill.source,
    })),
  ] satisfies Array<SlashCommandDescriptor>
}

function useComposerSlashCommands({
  displaySettingsStore,
  sessionStore,
}: {
  displaySettingsStore: ComposerDisplaySettingsStore
  sessionStore: ComposerSessionStore
}) {
  const cacheRef = React.useRef<{
    availableSkills?: SessionState["availableSkills"]
    commands?: Array<SlashCommandDescriptor>
    hideThinkingBlock?: boolean
    hideToolBlocks?: boolean
  }>({})
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubscribeSession = sessionStore.subscribe(listener)
      const unsubscribeDisplaySettings =
        displaySettingsStore.subscribe(listener)
      return () => {
        unsubscribeSession()
        unsubscribeDisplaySettings()
      }
    },
    [displaySettingsStore, sessionStore]
  )
  const getSnapshot = () => {
    const sessionState = sessionStore.getSnapshot()
    const displaySettings = displaySettingsStore.getSnapshot()
    const cache = cacheRef.current
    if (
      cache.commands &&
      cache.availableSkills === sessionState.availableSkills &&
      cache.hideThinkingBlock === sessionState.hideThinkingBlock &&
      cache.hideToolBlocks === displaySettings.hideToolBlocks
    ) {
      return cache.commands
    }

    const commands = buildComposerSlashCommands({
      availableSkills: sessionState.availableSkills,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      hideToolBlocks: displaySettings.hideToolBlocks,
    })
    cacheRef.current = {
      availableSkills: sessionState.availableSkills,
      commands,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      hideToolBlocks: displaySettings.hideToolBlocks,
    }
    return commands
  }

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function getClipboardImageFiles(data: DataTransfer) {
  const itemFiles = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(
      (file): file is File => file !== null && file.type.startsWith("image/")
    )

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return Array.from(data.files).filter((file) => file.type.startsWith("image/"))
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
    composerSyncNonce,
    centerMessages,
    contextUsageStore,
    displaySettingsStore,
    sessionStore,
    isSubmitting,
    isStreaming,
    awaitingFirstTurn,
    disabled = false,
    flush = false,
    topContent,
    fileInputRef,
    onComposerTextChange,
    onPickImages,
    onRemoveComposerImage,
    onSubmitPrompt,
    onAbort,
    onEditPendingMessage,
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
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const [thinkingPickerOpen, setThinkingPickerOpen] = React.useState(false)
  const [modelQuery, setModelQuery] = React.useState("")

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

  React.useEffect(() => {
    if (disabled) {
      setModelPickerOpen(false)
      setThinkingPickerOpen(false)
      return
    }

    if (!modelPickerOpen) {
      setModelQuery("")
    }
  }, [disabled, modelPickerOpen])

  const composerColumnClassName =
    centerMessages || flush
      ? `mx-auto flex w-full max-w-[80ch] flex-col ${
          centerMessages ? "gap-1.5" : "gap-3"
        }`
      : "flex w-full flex-col gap-3"

  const content = (
    <>
      <div className={composerColumnClassName}>
        {topContent}

        <ComposerPendingMessages
          currentPendingMessages={currentPendingMessages}
          onEditPendingMessage={onEditPendingMessage}
          onRemovePendingMessage={onRemovePendingMessage}
          onReorderPending={onReorderPending}
        />

        <div className="overflow-visible rounded-[18px] border bg-card">
          <ComposerPromptEditor
            composerImages={composerImages}
            composerText={composerText}
            composerSkill={composerSkill}
            composerSyncNonce={composerSyncNonce}
            isSubmitting={isSubmitting}
            isStreaming={isStreaming}
            awaitingFirstTurn={awaitingFirstTurn}
            disabled={disabled}
            fileInputRef={fileInputRef}
            promptRef={promptRef}
            displaySettingsStore={displaySettingsStore}
            sessionStore={sessionStore}
            onComposerTextChange={onComposerTextChange}
            onPickImages={onPickImages}
            onRemoveComposerImage={onRemoveComposerImage}
            onSubmitPrompt={onSubmitPrompt}
            onAbort={onAbort}
            onRunBuiltinSlashCommand={onRunBuiltinSlashCommand}
            requestPathCompletions={requestPathCompletions}
            requestFileCompletions={requestFileCompletions}
          />

          <ComposerPickers
            modelPickerOpen={modelPickerOpen}
            onModelPickerOpenChange={setModelPickerOpen}
            thinkingPickerOpen={thinkingPickerOpen}
            onThinkingPickerOpenChange={setThinkingPickerOpen}
            modelQuery={modelQuery}
            onModelQueryChange={setModelQuery}
            contextUsageStore={contextUsageStore}
            sessionStore={sessionStore}
            disabled={disabled}
            onSelectModel={onSelectModel}
            onSelectThinkingLevel={onSelectThinkingLevel}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        name="images"
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          if (disabled) return
          onPickImages(event.target.files)
        }}
      />
    </>
  )

  if (flush) return content

  return <div className="p-4">{content}</div>
})

const ComposerAttachments = React.memo(function ComposerAttachments({
  images,
  disabled,
  onRemoveImage,
}: ComposerAttachmentsProps) {
  if (images.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {images.map((image, index) => (
        <div key={promptImageKey(image)} className="relative">
          <img
            src={image.previewUrl}
            alt="Attachment preview"
            className="h-20 w-20 rounded-lg border object-cover"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => onRemoveImage(index)}
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  )
})

const ComposerPromptEditor = React.memo(function ComposerPromptEditor({
  composerImages,
  composerText,
  composerSkill,
  composerSyncNonce,
  isSubmitting,
  isStreaming,
  awaitingFirstTurn,
  disabled = false,
  fileInputRef,
  promptRef,
  displaySettingsStore,
  sessionStore,
  onComposerTextChange,
  onPickImages,
  onRemoveComposerImage,
  onSubmitPrompt,
  onAbort,
  onRunBuiltinSlashCommand,
  requestPathCompletions,
  requestFileCompletions,
}: ComposerPromptEditorProps) {
  const slashCommands = useComposerSlashCommands({
    displaySettingsStore,
    sessionStore,
  })
  const draftTextRef = React.useRef(composerText)
  const draftSkillRef = React.useRef<string | undefined>(composerSkill)
  const selectionRef = React.useRef({
    start: composerText.length,
    end: composerText.length,
  })
  const hasDraftTextRef = React.useRef(composerText.trim().length > 0)
  const [draftSkill, setDraftSkill] = React.useState(composerSkill)
  const [hasDraftText, setHasDraftText] = React.useState(
    hasDraftTextRef.current
  )
  const refreshAssistStateRef = React.useRef<() => void>(() => {})

  const syncDraftToParent = (text: string, skillName?: string) => {
    onComposerTextChange(serializeComposerDraft({ text, skillName }))
  }

  const scheduleDraftSync = (text: string, skillName?: string) => {
    syncDraftToParent(text, skillName)
  }

  const applyDraft = (
    text: string,
    skillName?: string,
    options?: {
      immediate?: boolean
      selection?: {
        start: number
        end: number
      }
    }
  ) => {
    const previousSkillName = draftSkillRef.current
    const nextHasDraftText = text.trim().length > 0

    draftTextRef.current = text
    draftSkillRef.current = skillName
    if (options?.selection) {
      selectionRef.current = options.selection
    }

    if (previousSkillName !== skillName) {
      setDraftSkill(skillName)
    }
    if (hasDraftTextRef.current !== nextHasDraftText) {
      hasDraftTextRef.current = nextHasDraftText
      setHasDraftText(nextHasDraftText)
    }
    if (promptRef.current && promptRef.current.value !== text) {
      promptRef.current.value = text
    }

    refreshAssistStateRef.current()

    if (options?.immediate) {
      syncDraftToParent(text, skillName)
      return
    }

    scheduleDraftSync(text, skillName)
  }

  const {
    visibleCompletion,
    selectedCompletionItem,
    slashMenuState,
    slashSelectionStore,
    getSelectedSlashCommand,
    syncSelection,
    applyCompletion,
    applySlashSuggestion,
    selectCompletionIndex,
    moveCompletionSelection,
    selectSlashIndex,
    moveSlashSelection,
    dismissMenus,
    refreshAssistState,
  } = useComposerAssist({
    draftTextRef,
    draftSkillRef,
    selectionRef,
    promptRef,
    slashCommands,
    requestPathCompletions,
    requestFileCompletions,
    applyDraft,
  })

  React.useEffect(() => {
    refreshAssistStateRef.current = refreshAssistState
  }, [refreshAssistState])

  React.useEffect(() => {
    const nextHasDraftText = composerText.trim().length > 0

    draftTextRef.current = composerText
    draftSkillRef.current = composerSkill
    selectionRef.current = {
      start: composerText.length,
      end: composerText.length,
    }
    hasDraftTextRef.current = nextHasDraftText
    setDraftSkill(composerSkill)
    setHasDraftText(nextHasDraftText)
    if (promptRef.current && promptRef.current.value !== composerText) {
      promptRef.current.value = composerText
    }
    dismissMenus()
    refreshAssistStateRef.current()
  }, [composerSkill, composerSyncNonce, composerText, dismissMenus, promptRef])

  const hasSubmittableContent = hasDraftText || composerImages.length > 0
  const acceptFollowUps = isStreaming || awaitingFirstTurn
  const blockInitialSubmit = isSubmitting && !acceptFollowUps
  const handleComposerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("button, textarea, input, [role='button']")) return

    event.preventDefault()
    promptRef.current?.focus()
  }

  const runPrimaryComposerAction = (streamingBehavior?: StreamingBehavior) => {
    if (disabled) return

    const draftText = draftTextRef.current
    const draftSkill = draftSkillRef.current
    const exact = findExactSlashCommand(draftText, slashCommands)
    if (exact) {
      if (exact.command.kind === "builtin") {
        dismissMenus()
        onRunBuiltinSlashCommand(exact.command.name, exact.args)
        return
      }

      if (!exact.args) {
        dismissMenus()
        applyDraft("", exact.command.skillName, { immediate: true })
        return
      }
    }

    const selectedSlashCommand = getSelectedSlashCommand()
    if (slashMenuState && selectedSlashCommand) {
      dismissMenus()
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

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return

    const parsed = parseComposerSkillMessage(event.target.value)
    const nextText = parsed.matched ? parsed.text : event.target.value
    const nextSelection = parsed.matched
      ? {
          start: nextText.length,
          end: nextText.length,
        }
      : {
          start: event.target.selectionStart,
          end: event.target.selectionEnd,
        }

    applyDraft(nextText, parsed.matched ? parsed.skillName : undefined, {
      selection: nextSelection,
    })
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return

    const imageFiles = getClipboardImageFiles(event.clipboardData)
    if (imageFiles.length === 0) return

    onPickImages(imageFiles)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    const draftText = draftTextRef.current
    const currentDraftSkill = draftSkillRef.current
    const ctrlShortcut = event.ctrlKey && !event.metaKey

    if (event.key === "Backspace" && !draftText && currentDraftSkill) {
      applyDraft("", undefined, { immediate: true })
      return
    }

    if (
      visibleCompletion &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault()
      moveCompletionSelection(event.key === "ArrowDown" ? 1 : -1)
      return
    }

    if (
      slashMenuState &&
      !visibleCompletion &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault()
      moveSlashSelection(event.key === "ArrowDown" ? 1 : -1)
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
        moveCompletionSelection(direction)
        return
      }

      if (slashMenuState) {
        event.preventDefault()
        moveSlashSelection(direction)
      }
    }

    if (event.key === "Tab") {
      if (visibleCompletion && selectedCompletionItem) {
        event.preventDefault()
        applyCompletion(selectedCompletionItem)
        return
      }
      const selectedSlashCommand = getSelectedSlashCommand()
      if (slashMenuState && selectedSlashCommand) {
        event.preventDefault()
        applySlashSuggestion(selectedSlashCommand)
        return
      }
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      if (visibleCompletion && selectedCompletionItem) {
        event.preventDefault()
        applyCompletion(selectedCompletionItem)
        return
      }

      event.preventDefault()
      runPrimaryComposerAction(
        event.altKey ? "followUp" : acceptFollowUps ? "steer" : undefined
      )
      return
    }

    if (
      event.key === "Escape" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      if (visibleCompletion || slashMenuState) {
        event.preventDefault()
        event.stopPropagation()
        dismissMenus()
        return
      }

      if (isStreaming && !event.repeat) {
        event.preventDefault()
        event.stopPropagation()
        onAbort()
        return
      }
    }

    if (
      event.key === "ArrowUp" &&
      !visibleCompletion &&
      !slashMenuState &&
      !draftText &&
      currentDraftSkill &&
      selectionIsAtStart(promptRef.current)
    ) {
      applyDraft("", undefined, { immediate: true })
    }
  }

  return (
    <div
      className="relative min-h-[90px] cursor-text overflow-visible rounded-t-[18px] border-b border-border/70 bg-card px-3 pt-3 pb-14"
      onMouseDown={handleComposerMouseDown}
    >
      <div className="relative min-w-0">
        <ComposerAssistMenu
          visibleCompletion={visibleCompletion}
          slashMenuState={slashMenuState}
          slashSelectionStore={slashSelectionStore}
          onHoverCompletion={selectCompletionIndex}
          onApplyCompletion={applyCompletion}
          onHoverSlashCommand={selectSlashIndex}
          onApplySlashSuggestion={applySlashSuggestion}
        />

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
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
                  disabled={disabled}
                  onClick={() =>
                    applyDraft(draftTextRef.current, undefined, {
                      immediate: true,
                    })
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
              autoComplete="off"
              data-1p-ignore="true"
              data-form-type="other"
              data-lpignore="true"
              defaultValue={composerText}
              onChange={handleTextChange}
              onClick={syncSelection}
              onKeyUp={syncSelection}
              onSelect={syncSelection}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={disabled}
              placeholder={
                acceptFollowUps
                  ? "Add a message to the queue..."
                  : draftSkill
                    ? `Ask with ${formatComposerSkillName(draftSkill)}…`
                    : "Ask anything…"
              }
              className="max-h-[min(40dvh,18rem)] min-h-[22px] max-w-full min-w-0 flex-1 basis-[min(240px,100%)] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-0 py-0 text-base shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 disabled:cursor-text disabled:bg-transparent disabled:opacity-60 md:text-sm dark:bg-transparent dark:disabled:bg-transparent"
            />
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Add images"
          aria-label="Add images"
          className="cursor-pointer"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlusIcon />
        </Button>
      </div>

      <div className="absolute right-3 bottom-3 flex flex-nowrap items-center justify-end gap-2">
        {!acceptFollowUps ? (
          <Button
            size="icon-sm"
            className="cursor-pointer"
            disabled={
              disabled ||
              blockInitialSubmit ||
              (!hasSubmittableContent && !isStreaming && !slashMenuState)
            }
            title="Send"
            aria-label="Send"
            onClick={() => {
              runPrimaryComposerAction(undefined)
            }}
          >
            {blockInitialSubmit ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        ) : null}

        {acceptFollowUps ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={disabled || !hasSubmittableContent}
              onClick={() => runPrimaryComposerAction("followUp")}
            >
              <ListEndIcon data-icon="inline-start" />
              Follow-up
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={disabled || !hasSubmittableContent}
              onClick={() => runPrimaryComposerAction("steer")}
            >
              <ListStartIcon data-icon="inline-start" />
              Steer
            </Button>
            {isStreaming ? (
              <Button
                variant="destructive"
                size="icon-sm"
                className="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
                title="Abort (Esc)"
                aria-label="Abort"
                disabled={disabled}
                onClick={onAbort}
              >
                <SquareIcon className="fill-current text-white" />
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      <ComposerAttachments
        images={composerImages}
        disabled={disabled}
        onRemoveImage={onRemoveComposerImage}
      />
    </div>
  )
})
