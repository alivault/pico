import * as React from "react"
import {
  ArrowUpIcon,
  GitPullRequestArrowIcon,
  ImagePlusIcon,
  ListEndIcon,
  ListStartIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import type { PromptImage, SessionState, StreamingBehavior } from "@/lib/pico"
import type { CompletionItem } from "@/lib/pico/api"

import type { ComposerDiffLineComment } from "@/features/pico/app-shell-composer-state"
import type { SlashCommandDescriptor } from "@/features/pico/composer-utils"
import {
  shallow,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { TitleTooltip } from "@/components/ui/tooltip"
import { ComposerAssistMenu } from "@/features/pico/composer-assist-menu"
import { ComposerPendingMessages } from "@/features/pico/composer-pending-messages"
import { ComposerPickers } from "@/features/pico/composer-pickers"
import { matchesShortcutEvent } from "@/features/pico/keyboard-shortcuts"
import type { ComposerContextUsageStore } from "@/features/pico/composer-context-usage-indicator"
import {
  formatComposerDiffLineCommentReference,
  formatComposerSkillName,
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pico/composer-utils"
import { promptImageKey } from "@/features/pico/conversation-view"
import {
  findExactSlashCommand,
  useComposerAssist,
} from "@/features/pico/use-composer-assist"

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

type ComposerSessionStore = PicoStore<SessionState>

type ComposerDisplaySettingsStore = PicoStore<{
  autoScrollEnabled: boolean
  centerMessages: boolean
  hideToolBlocks: boolean
}>

type ComposerPanelProps = {
  activeSessionId?: string
  currentPendingMessages: Array<PendingComposerMessage>
  composerDiffLineComments: Array<ComposerDiffLineComment>
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
  viewerContextId: string
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onComposerTextChange: (value: string) => void
  onPickImages: (files: ImageFileSelection) => void
  onRemoveComposerDiffLineComment: (id: string) => void
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
  composerDiffLineComments: Array<ComposerDiffLineComment>
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
  onRemoveComposerDiffLineComment: (id: string) => void
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
  sessionHasFile,
}: {
  availableSkills: SessionState["availableSkills"]
  hideThinkingBlock: boolean
  hideToolBlocks: boolean
  sessionHasFile: boolean
}) {
  return [
    {
      kind: "builtin" as const,
      name: "login",
      description: "Configure provider authentication",
    },
    {
      kind: "builtin" as const,
      name: "logout",
      description: "Remove provider authentication",
    },
    {
      kind: "builtin" as const,
      name: "compact",
      description: "Summarize the session to reduce context size",
    },
    {
      kind: "builtin" as const,
      name: "clone",
      description: "Duplicate the current active branch into a new session",
    },
    ...(sessionHasFile
      ? [
          {
            kind: "builtin" as const,
            name: "delete",
            description: "Delete the current session",
          },
        ]
      : []),
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
    ...(sessionHasFile
      ? [
          {
            kind: "builtin" as const,
            name: "rename",
            description: "Rename the current session",
          },
        ]
      : []),
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
  const { availableSkills, hideThinkingBlock, sessionHasFile } = useSelector(
    sessionStore,
    (sessionState) => ({
      availableSkills: sessionState.availableSkills,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      sessionHasFile: Boolean(sessionState.sessionFile),
    }),
    { compare: shallow }
  )
  const hideToolBlocks = useSelector(
    displaySettingsStore,
    (displaySettings) => displaySettings.hideToolBlocks
  )

  return React.useMemo(
    () =>
      buildComposerSlashCommands({
        availableSkills,
        hideThinkingBlock,
        hideToolBlocks,
        sessionHasFile,
      }),
    [availableSkills, hideThinkingBlock, hideToolBlocks, sessionHasFile]
  )
}

type ComposerPickerState = {
  modelPickerOpen: boolean
  thinkingPickerOpen: boolean
  modelQuery: string
}

type ComposerPickerAction =
  | { type: "openModel" }
  | { type: "openThinking" }
  | { type: "setModelOpen"; open: boolean }
  | { type: "setThinkingOpen"; open: boolean }
  | { type: "setModelQuery"; query: string }
  | { type: "syncDisabled"; disabled: boolean }

const INITIAL_COMPOSER_PICKER_STATE: ComposerPickerState = {
  modelPickerOpen: false,
  thinkingPickerOpen: false,
  modelQuery: "",
}

function composerPickerReducer(
  state: ComposerPickerState,
  action: ComposerPickerAction
): ComposerPickerState {
  switch (action.type) {
    case "openModel":
      return { ...state, modelPickerOpen: true, thinkingPickerOpen: false }
    case "openThinking":
      return { ...state, modelPickerOpen: false, thinkingPickerOpen: true }
    case "setModelOpen":
      return {
        ...state,
        modelPickerOpen: action.open,
        modelQuery: action.open ? state.modelQuery : "",
      }
    case "setThinkingOpen":
      return { ...state, thinkingPickerOpen: action.open }
    case "setModelQuery":
      return { ...state, modelQuery: action.query }
    case "syncDisabled":
      if (action.disabled) {
        return {
          ...state,
          modelPickerOpen: false,
          thinkingPickerOpen: false,
          modelQuery: "",
        }
      }
      if (!state.modelPickerOpen && state.modelQuery) {
        return { ...state, modelQuery: "" }
      }
      return state
  }
}

function getClipboardImageFiles(data: DataTransfer) {
  const itemFiles = Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return []
    const file = item.getAsFile()
    return file?.type.startsWith("image/") ? [file] : []
  })

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return Array.from(data.files).filter((file) => file.type.startsWith("image/"))
}

export function ComposerPanel({
  activeSessionId,
  currentPendingMessages,
  composerDiffLineComments,
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
  viewerContextId,
  fileInputRef,
  onComposerTextChange,
  onPickImages,
  onRemoveComposerDiffLineComment,
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
  ref,
}: ComposerPanelProps & {
  ref?: React.Ref<ComposerPanelHandle>
}) {
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [pickerState, dispatchPickerState] = React.useReducer(
    composerPickerReducer,
    INITIAL_COMPOSER_PICKER_STATE
  )
  const { modelPickerOpen, thinkingPickerOpen, modelQuery } = pickerState

  React.useImperativeHandle(
    ref,
    () => ({
      focusPrompt: (options) => {
        promptRef.current?.focus(options)
      },
      openModelPicker: () => {
        dispatchPickerState({ type: "openModel" })
      },
      openThinkingPicker: () => {
        dispatchPickerState({ type: "openThinking" })
      },
    }),
    []
  )

  React.useEffect(() => {
    dispatchPickerState({ type: "syncDisabled", disabled })
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
            composerDiffLineComments={composerDiffLineComments}
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
            onRemoveComposerDiffLineComment={onRemoveComposerDiffLineComment}
            onRemoveComposerImage={onRemoveComposerImage}
            onSubmitPrompt={onSubmitPrompt}
            onAbort={onAbort}
            onRunBuiltinSlashCommand={onRunBuiltinSlashCommand}
            requestPathCompletions={requestPathCompletions}
            requestFileCompletions={requestFileCompletions}
          />

          <ComposerPickers
            activeSessionId={activeSessionId}
            modelPickerOpen={modelPickerOpen}
            onModelPickerOpenChange={(open) =>
              dispatchPickerState({ type: "setModelOpen", open })
            }
            thinkingPickerOpen={thinkingPickerOpen}
            onThinkingPickerOpenChange={(open) =>
              dispatchPickerState({ type: "setThinkingOpen", open })
            }
            modelQuery={modelQuery}
            onModelQueryChange={(query) =>
              dispatchPickerState({ type: "setModelQuery", query })
            }
            contextUsageStore={contextUsageStore}
            sessionStore={sessionStore}
            disabled={disabled}
            viewerContextId={viewerContextId}
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
}

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
            className="h-20 rounded-lg border object-cover"
          />
          <Button
            type="button"
            size="icon-sm"
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
  composerDiffLineComments,
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
  onRemoveComposerDiffLineComment,
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
  const composerSyncNonceRef = React.useRef(composerSyncNonce)
  const [draftSkill, setDraftSkill] = React.useState(composerSkill)
  const [hasDraftText, setHasDraftText] = React.useState(
    hasDraftTextRef.current
  )
  const refreshAssistStateRef = React.useRef<() => void>(() => {})
  const assistPointerSelectionSuppressedRef = React.useRef(false)
  const [
    assistPointerSelectionSuppressed,
    setAssistPointerSelectionSuppressed,
  ] = React.useState(false)

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
    const sameLocalDraft =
      composerText === draftTextRef.current &&
      composerSkill === draftSkillRef.current
    const syncNonceChanged = composerSyncNonce !== composerSyncNonceRef.current
    composerSyncNonceRef.current = composerSyncNonce

    if (sameLocalDraft && !syncNonceChanged) {
      refreshAssistStateRef.current()
      return
    }

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

  const hasSubmittableContent =
    hasDraftText ||
    composerDiffLineComments.length > 0 ||
    composerImages.length > 0
  const responseInFlight = isStreaming || awaitingFirstTurn || isSubmitting
  const acceptFollowUps = responseInFlight
  const setAssistPointerSelectionSuppressedValue = (next: boolean) => {
    assistPointerSelectionSuppressedRef.current = next
    setAssistPointerSelectionSuppressed(next)
  }
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
    const moveDownShortcut = matchesShortcutEvent(
      event.nativeEvent,
      "Control+J"
    )
    const moveUpShortcut = matchesShortcutEvent(event.nativeEvent, "Control+K")

    if (event.key === "Backspace" && !draftText && currentDraftSkill) {
      applyDraft("", undefined, { immediate: true })
      return
    }

    if (
      event.key === "Backspace" &&
      !draftText &&
      !currentDraftSkill &&
      composerDiffLineComments.length > 0
    ) {
      const lastComment = composerDiffLineComments.at(-1)
      if (lastComment) onRemoveComposerDiffLineComment(lastComment.id)
      return
    }

    if (
      visibleCompletion &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault()
      setAssistPointerSelectionSuppressedValue(true)
      moveCompletionSelection(event.key === "ArrowDown" ? 1 : -1)
      return
    }

    if (
      slashMenuState &&
      !visibleCompletion &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault()
      setAssistPointerSelectionSuppressedValue(true)
      moveSlashSelection(event.key === "ArrowDown" ? 1 : -1)
      return
    }

    if (moveDownShortcut || moveUpShortcut) {
      const direction = moveDownShortcut ? 1 : -1
      if (visibleCompletion) {
        event.preventDefault()
        event.stopPropagation()
        setAssistPointerSelectionSuppressedValue(true)
        moveCompletionSelection(direction)
        return
      }

      if (slashMenuState) {
        event.preventDefault()
        event.stopPropagation()
        setAssistPointerSelectionSuppressedValue(true)
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

      if (responseInFlight && !event.repeat) {
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

  const handleHoverCompletion = (index: number) => {
    if (assistPointerSelectionSuppressedRef.current) return
    selectCompletionIndex(index)
  }

  const handleMoveCompletion = (index: number) => {
    setAssistPointerSelectionSuppressedValue(false)
    selectCompletionIndex(index)
  }

  const handleHoverSlashCommand = (index: number) => {
    if (assistPointerSelectionSuppressedRef.current) return
    selectSlashIndex(index)
  }

  const handleMoveSlashCommand = (index: number) => {
    setAssistPointerSelectionSuppressedValue(false)
    selectSlashIndex(index)
  }

  return (
    <div
      role="presentation"
      className="relative min-h-[90px] cursor-text overflow-visible rounded-t-[18px] border-b border-border/70 bg-card px-3 pt-3 pb-14"
      onMouseDown={handleComposerMouseDown}
    >
      <div className="relative min-w-0">
        <ComposerAssistMenu
          visibleCompletion={visibleCompletion}
          slashMenuState={slashMenuState}
          slashSelectionStore={slashSelectionStore}
          pointerSelectionSuppressed={assistPointerSelectionSuppressed}
          onHoverCompletion={handleHoverCompletion}
          onMoveCompletion={handleMoveCompletion}
          onApplyCompletion={applyCompletion}
          onHoverSlashCommand={handleHoverSlashCommand}
          onMoveSlashCommand={handleMoveSlashCommand}
          onApplySlashSuggestion={applySlashSuggestion}
        />

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            {draftSkill ? (
              <span className="inline-flex h-7 max-w-[45%] shrink-0 items-center gap-0 overflow-hidden rounded-full bg-primary/10 pr-0.5 pl-2 text-sm font-medium text-primary">
                <span className="truncate">
                  Skill: {formatComposerSkillName(draftSkill)}
                </span>
                <Button
                  size="icon-sm"
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

            {composerDiffLineComments.map((comment) => (
              <span
                key={comment.id}
                title={`${formatComposerDiffLineCommentReference(comment)}: ${comment.text}`}
                className="inline-flex h-7 max-w-[45%] shrink-0 items-center gap-1 overflow-hidden rounded-full bg-amber-500/10 pr-0.5 pl-2 text-sm font-medium text-amber-700 dark:text-amber-300"
              >
                <GitPullRequestArrowIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  Diff: {formatComposerDiffLineCommentReference(comment)}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-1 rounded-full text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-300"
                  aria-label={`Remove diff comment for ${formatComposerDiffLineCommentReference(comment)}`}
                  disabled={disabled}
                  onClick={() => onRemoveComposerDiffLineComment(comment.id)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </span>
            ))}

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
              className="max-h-[min(40dvh,18rem)] min-h-[22px] max-w-full min-w-0 flex-1 basis-[min(240px,100%)] resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 text-base shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 disabled:cursor-text disabled:bg-transparent disabled:opacity-60 md:text-sm dark:bg-transparent dark:disabled:bg-transparent"
            />
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <TitleTooltip title="Add images">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add images"
            className="cursor-pointer"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlusIcon />
          </Button>
        </TitleTooltip>
      </div>

      <div className="absolute right-3 bottom-3 flex flex-nowrap items-center justify-end gap-2">
        {!acceptFollowUps ? (
          <TitleTooltip
            title="Send"
            rows={[
              { title: "Send", kbd: "Enter" },
              { title: "New line", kbd: "⇧ Enter" },
            ]}
          >
            <Button
              size="icon"
              className="cursor-pointer"
              disabled={
                disabled ||
                blockInitialSubmit ||
                (!hasSubmittableContent && !isStreaming && !slashMenuState)
              }
              aria-label="Send"
              onClick={() => {
                runPrimaryComposerAction(undefined)
              }}
            >
              {blockInitialSubmit ? <Spinner /> : <ArrowUpIcon />}
            </Button>
          </TitleTooltip>
        ) : null}

        {acceptFollowUps ? (
          <>
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={disabled || !hasSubmittableContent}
              onClick={() => runPrimaryComposerAction("followUp")}
            >
              <ListEndIcon data-icon="inline-start" />
              Follow-up
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={disabled || !hasSubmittableContent}
              onClick={() => runPrimaryComposerAction("steer")}
            >
              <ListStartIcon data-icon="inline-start" />
              Steer
            </Button>
            {responseInFlight ? (
              <TitleTooltip title="Abort" kbd="Esc">
                <Button
                  variant="destructive"
                  size="icon"
                  className="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
                  aria-label="Abort"
                  disabled={disabled}
                  onClick={onAbort}
                >
                  <SquareIcon className="fill-current text-white" />
                </Button>
              </TitleTooltip>
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
