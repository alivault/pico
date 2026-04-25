import * as React from "react"
import {
  ArrowUpIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import type {
  ModelOption,
  PromptImage,
  SessionState,
  StreamingBehavior,
} from "@/lib/pi-web"
import type { CompletionItem } from "@/lib/pi-web-api"

import type { SlashCommandDescriptor } from "@/features/pi-web/composer-utils"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ComposerAssistMenu } from "@/features/pi-web/composer-assist-menu"
import { ComposerPendingMessages } from "@/features/pi-web/composer-pending-messages"
import { ComposerPickers } from "@/features/pi-web/composer-pickers"
import {
  formatComposerSkillName,
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pi-web/composer-utils"
import { promptImageKey } from "@/features/pi-web/conversation-view"
import {
  findExactSlashCommand,
  useComposerAssist,
} from "@/features/pi-web/use-composer-assist"

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

type ComposerPanelProps = {
  currentPendingMessages: Array<PendingComposerMessage>
  composerImages: Array<PromptImage>
  composerText: string
  composerSkill?: string
  composerSyncNonce: number
  availableModels: Array<ModelOption>
  model?: ModelOption
  thinkingLevel: string
  availableThinkingLevels: Array<string>
  contextUsage?: SessionState["contextUsage"]
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  slashCommands: Array<SlashCommandDescriptor>
  onComposerTextChange: (value: string) => void
  onPickImages: (files: ImageFileSelection) => void
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

type ComposerPromptEditorProps = {
  composerImages: Array<PromptImage>
  composerText: string
  composerSkill?: string
  composerSyncNonce: number
  isSubmitting: boolean
  isStreaming: boolean
  awaitingFirstTurn: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  promptRef: React.RefObject<HTMLTextAreaElement | null>
  slashCommands: Array<SlashCommandDescriptor>
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
    if (!modelPickerOpen) {
      setModelQuery("")
    }
  }, [modelPickerOpen])

  return (
    <div className="flex flex-col gap-3 p-4">
      <ComposerPendingMessages
        currentPendingMessages={currentPendingMessages}
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
          fileInputRef={fileInputRef}
          promptRef={promptRef}
          slashCommands={slashCommands}
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

function ComposerPromptEditor({
  composerImages,
  composerText,
  composerSkill,
  composerSyncNonce,
  isSubmitting,
  isStreaming,
  awaitingFirstTurn,
  fileInputRef,
  promptRef,
  slashCommands,
  onComposerTextChange,
  onPickImages,
  onRemoveComposerImage,
  onSubmitPrompt,
  onAbort,
  onRunBuiltinSlashCommand,
  requestPathCompletions,
  requestFileCompletions,
}: ComposerPromptEditorProps) {
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
    slashSelectionIndex,
    selectedSlashCommand,
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

  const runPrimaryComposerAction = (streamingBehavior?: StreamingBehavior) => {
    const draftText = draftTextRef.current
    const draftSkill = draftSkillRef.current
    const exact = findExactSlashCommand(draftText, slashCommands)
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

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
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
    const imageFiles = getClipboardImageFiles(event.clipboardData)
    if (imageFiles.length === 0) return

    onPickImages(imageFiles)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        ctrlShortcut && event.altKey
          ? "followUp"
          : acceptFollowUps
            ? "steer"
            : undefined
      )
      return
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
      currentDraftSkill &&
      selectionIsAtStart(promptRef.current)
    ) {
      applyDraft("", undefined, { immediate: true })
    }
  }

  return (
    <div className="relative overflow-visible rounded-t-[18px] border-b border-border/70 bg-card px-3 py-3">
      <div
        className={`relative grid min-w-0 items-end gap-2 ${
          isStreaming
            ? "grid-cols-[auto_minmax(0,1fr)]"
            : "grid-cols-[auto_minmax(0,1fr)_auto]"
        }`}
      >
        <ComposerAssistMenu
          visibleCompletion={visibleCompletion}
          slashMenuState={slashMenuState}
          slashSelectionIndex={slashSelectionIndex}
          onHoverCompletion={selectCompletionIndex}
          onApplyCompletion={applyCompletion}
          onHoverSlashCommand={selectSlashIndex}
          onApplySlashSuggestion={applySlashSuggestion}
        />

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
              defaultValue={composerText}
              onChange={handleTextChange}
              onClick={syncSelection}
              onKeyUp={syncSelection}
              onSelect={syncSelection}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                acceptFollowUps
                  ? "Write a steer or follow-up message…"
                  : draftSkill
                    ? `Ask with ${formatComposerSkillName(draftSkill)}…`
                    : "Ask anything…"
              }
              className="min-h-[22px] flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-base shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 md:text-sm dark:bg-transparent"
            />
          </div>
        </div>

        {!isStreaming ? (
          <Button
            size="icon-sm"
            disabled={
              blockInitialSubmit ||
              (!hasSubmittableContent && !isStreaming && !slashMenuState)
            }
            title="Send"
            aria-label="Send"
            onClick={() => {
              runPrimaryComposerAction(acceptFollowUps ? "steer" : undefined)
            }}
          >
            {blockInitialSubmit ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        ) : null}
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
            disabled={!hasSubmittableContent}
            onClick={() => runPrimaryComposerAction("followUp")}
          >
            Queue
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSubmittableContent}
            onClick={() => runPrimaryComposerAction("steer")}
          >
            Steer
          </Button>
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon-sm"
              title="Abort"
              aria-label="Abort"
              onClick={onAbort}
            >
              <SquareIcon />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
