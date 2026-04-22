import * as React from "react"

import type { CompletionItem } from "@/lib/pi-web-api"

import type {
  ComposerCompletionQuery,
  SlashCommandDescriptor,
  SlashCommandInput,
} from "@/features/pi-web/composer-utils"

import {
  applyCompletionItem,
  getFileReferenceCompletionQuery,
  getPathCompletionQuery,
  matchingSlashCommands,
  parseComposerSkillMessage,
  parseSlashCommandInput,
  sameCompletionContext,
} from "@/features/pi-web/composer-utils"

export type ComposerSelection = {
  start: number
  end: number
}

type CompletionState = {
  query: ComposerCompletionQuery
  items: Array<CompletionItem>
  selectedIndex: number
}

export type ComposerVisibleCompletion = CompletionState

export type ComposerSlashMenuState = SlashCommandInput & {
  commands: Array<SlashCommandDescriptor>
}

type ApplyDraftOptions = {
  immediate?: boolean
}

type UseComposerAssistOptions = {
  draftText: string
  draftSkill?: string
  selection: ComposerSelection
  promptRef: React.RefObject<HTMLTextAreaElement | null>
  slashCommands: Array<SlashCommandDescriptor>
  requestPathCompletions: (prefix: string) => Promise<Array<CompletionItem>>
  requestFileCompletions: (
    query: string,
    isQuotedPrefix: boolean
  ) => Promise<Array<CompletionItem>>
  applyDraft: (
    text: string,
    skillName?: string,
    options?: ApplyDraftOptions
  ) => void
  setSelection: React.Dispatch<React.SetStateAction<ComposerSelection>>
}

export function findExactSlashCommand(
  value: string,
  commands: Array<SlashCommandDescriptor>
) {
  const parsed = parseSlashCommandInput(value)
  if (!parsed) return null

  const command = commands.find((entry) => entry.name === parsed.name)
  if (!command) return null

  return { command, args: parsed.args }
}

function resolveSlashMenuState({
  draftText,
  draftSkill,
  slashCommands,
}: {
  draftText: string
  draftSkill?: string
  slashCommands: Array<SlashCommandDescriptor>
}) {
  if (draftSkill) return null

  const parsed = parseSlashCommandInput(draftText)
  if (!parsed || parsed.hasArguments) return null

  const commands = matchingSlashCommands(slashCommands, parsed.name)
  if (commands.length === 0) return null

  return {
    ...parsed,
    commands,
  }
}

export function useComposerAssist({
  draftText,
  draftSkill,
  selection,
  promptRef,
  slashCommands,
  requestPathCompletions,
  requestFileCompletions,
  applyDraft,
  setSelection,
}: UseComposerAssistOptions) {
  const [completionState, setCompletionState] =
    React.useState<CompletionState | null>(null)
  const completionRequestIdRef = React.useRef(0)
  const [slashSelectionIndex, setSlashSelectionIndex] = React.useState(0)

  const slashMenuState = React.useMemo(
    () =>
      resolveSlashMenuState({
        draftText,
        draftSkill,
        slashCommands,
      }),
    [draftSkill, draftText, slashCommands]
  )

  React.useEffect(() => {
    setSlashSelectionIndex((current) => {
      if (!slashMenuState) return 0
      return Math.max(0, Math.min(slashMenuState.commands.length - 1, current))
    })
  }, [slashMenuState])

  const completionQuery = React.useMemo(() => {
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
  }, [draftText, selection.end, selection.start])

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

  const syncSelection = React.useCallback(() => {
    const textarea = promptRef.current
    if (!textarea) return
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    })
  }, [promptRef, setSelection])

  const setCaret = React.useCallback(
    (start: number, end = start) => {
      requestAnimationFrame(() => {
        promptRef.current?.focus()
        promptRef.current?.setSelectionRange(start, end)
        setSelection({ start, end })
      })
    },
    [promptRef, setSelection]
  )

  const applyCompletion = React.useCallback(
    (item: CompletionItem, query = visibleCompletion?.query) => {
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
    },
    [applyDraft, draftText, setCaret, visibleCompletion?.query]
  )

  const applySlashSuggestion = React.useCallback(
    (command: SlashCommandDescriptor | null) => {
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
    },
    [applyDraft, draftText, promptRef, setSelection]
  )

  const selectCompletionIndex = React.useCallback((index: number) => {
    setCompletionState((current) =>
      current ? { ...current, selectedIndex: index } : current
    )
  }, [])

  const moveCompletionSelection = React.useCallback((direction: -1 | 1) => {
    setCompletionState((current) => {
      if (!current) return current
      const total = current.items.length
      return {
        ...current,
        selectedIndex: (current.selectedIndex + direction + total) % total,
      }
    })
  }, [])

  const moveSlashSelection = React.useCallback(
    (direction: -1 | 1) => {
      setSlashSelectionIndex((current) => {
        const total = slashMenuState?.commands.length || 0
        if (total === 0) return 0
        return (current + direction + total) % total
      })
    },
    [slashMenuState]
  )

  const dismissMenus = React.useCallback(() => {
    setCompletionState(null)
    setSlashSelectionIndex(0)
  }, [])

  return {
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
    selectSlashIndex: setSlashSelectionIndex,
    moveSlashSelection,
    dismissMenus,
  }
}
