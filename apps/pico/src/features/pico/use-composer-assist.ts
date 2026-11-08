import * as React from "react"
import { AsyncDebouncer } from "@tanstack/pacer"

import type { CompletionItem } from "@/lib/pico/api"
import { settle } from "@/lib/settle"
import { useLatestRef } from "@/features/pico/app-shell-common"

import type {
  ComposerCompletionQuery,
  SlashCommandDescriptor,
  SlashCommandInput,
} from "@/features/pico/composer-utils"

import {
  applyCompletionItem,
  getFileReferenceCompletionQuery,
  getPathCompletionQuery,
  matchingSlashCommands,
  parseComposerSkillMessage,
  parseSlashCommandInput,
  sameCompletionContext,
} from "@/features/pico/composer-utils"

export type ComposerSelection = {
  start: number
  end: number
}

type CompletionState = {
  query: ComposerCompletionQuery
  items: Array<CompletionItem>
  selectedIndex: number
}

type CompletionRequestFns = Pick<
  UseComposerAssistOptions,
  "requestFileCompletions" | "requestPathCompletions"
>

type CompletionLoader = (
  query: ComposerCompletionQuery,
  requestFns: CompletionRequestFns
) => Promise<Array<CompletionItem>>

/**
 * A debouncer that gets the request functions with each call, so that the
 * hook does not read a ref when it makes the debouncer. The last call wins.
 */
function createCompletionDebouncer() {
  return new AsyncDebouncer<CompletionLoader>(
    async (query, { requestFileCompletions, requestPathCompletions }) => {
      return query.kind === "file-reference"
        ? await requestFileCompletions(query.rawPrefix, query.isQuotedPrefix)
        : await requestPathCompletions(query.rawPrefix)
    },
    {
      key: "pico.composer.completions",
      wait: 80,
    }
  )
}

/** Waits for the debounced load. Pacer types its result as a nested promise. */
async function loadDebouncedCompletions(
  debouncer: ReturnType<typeof createCompletionDebouncer>,
  query: ComposerCompletionQuery,
  requestFns: CompletionRequestFns
): Promise<Array<CompletionItem> | undefined> {
  return await debouncer.maybeExecute(query, requestFns)
}

type CompletionAction =
  | { type: "clear" }
  | {
      type: "loaded"
      query: ComposerCompletionQuery
      items: Array<CompletionItem>
    }
  | { type: "move-selection"; direction: -1 | 1 }
  | { type: "select"; index: number }

export type ComposerVisibleCompletion = CompletionState

export type ComposerSlashMenuState = SlashCommandInput & {
  commands: Array<SlashCommandDescriptor>
}

type ApplyDraftOptions = {
  immediate?: boolean
  selection?: ComposerSelection
}

type MutableRef<T> = {
  current: T
}

export type ComposerAssistSelectionStore = {
  getSnapshot: () => number
  subscribe: (listener: () => void) => () => void
}

type MutableSelectionStore = ComposerAssistSelectionStore & {
  set: (next: number) => void
}

function createSelectionStore(initialValue = 0): MutableSelectionStore {
  let value = initialValue
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next) => {
      if (Object.is(value, next)) return
      value = next
      listeners.forEach((listener) => listener())
    },
  }
}

type UseComposerAssistOptions = {
  draftTextRef: MutableRef<string>
  draftSkillRef: MutableRef<string | undefined>
  selectionRef: MutableRef<ComposerSelection>
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

function sameSelection(left: ComposerSelection, right: ComposerSelection) {
  return left.start === right.start && left.end === right.end
}

function sameSlashCommand(
  left: SlashCommandDescriptor,
  right: SlashCommandDescriptor
) {
  if (left.kind !== right.kind || left.name !== right.name) return false
  if (left.kind === "skill" && right.kind === "skill") {
    return left.skillName === right.skillName
  }
  return true
}

function sameSlashMenuState(
  left: ComposerSlashMenuState | null,
  right: ComposerSlashMenuState | null
) {
  if (left === right) return true
  if (!left || !right) return false
  if (
    left.rawValue !== right.rawValue ||
    left.name !== right.name ||
    left.args !== right.args ||
    left.hasArguments !== right.hasArguments
  ) {
    return false
  }

  return (
    left.commands.length === right.commands.length &&
    left.commands.every((command, index) => {
      const other = right.commands[index]
      return Boolean(other && sameSlashCommand(command, other))
    })
  )
}

function sameCompletionQuery(
  left: ComposerCompletionQuery | null,
  right: ComposerCompletionQuery | null
) {
  if (left === right) return true
  if (!left || !right) return false
  return sameCompletionContext(left, right)
}

function completionStateReducer(
  current: CompletionState | null,
  action: CompletionAction
): CompletionState | null {
  switch (action.type) {
    case "clear":
      return current ? null : current
    case "loaded": {
      const filteredItems = action.items.filter((item) => Boolean(item.value))
      if (filteredItems.length === 0) return current ? null : current

      const selectedItem =
        current && sameCompletionContext(current.query, action.query)
          ? current.items[current.selectedIndex] || current.items[0]
          : null
      const selectedIndex = selectedItem
        ? Math.max(
            0,
            filteredItems.findIndex((item) => item.value === selectedItem.value)
          )
        : 0

      return {
        query: action.query,
        items: filteredItems,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
      }
    }
    case "move-selection": {
      if (!current) return current
      const total = current.items.length
      return {
        ...current,
        selectedIndex:
          (current.selectedIndex + action.direction + total) % total,
      }
    }
    case "select":
      return current ? { ...current, selectedIndex: action.index } : current
    default:
      action satisfies never
      return current
  }
}

function resolveCompletionQuery({
  draftText,
  selection,
}: {
  draftText: string
  selection: ComposerSelection
}) {
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
}

export function useComposerAssist({
  draftTextRef,
  draftSkillRef,
  selectionRef,
  promptRef,
  slashCommands,
  requestPathCompletions,
  requestFileCompletions,
  applyDraft,
}: UseComposerAssistOptions) {
  const [completionQuery, setCompletionQuery] =
    React.useState<ComposerCompletionQuery | null>(null)
  const completionQueryRef = React.useRef<ComposerCompletionQuery | null>(null)
  const [completionState, dispatchCompletionState] = React.useReducer(
    completionStateReducer,
    null
  )
  const completionRequestIdRef = React.useRef(0)
  const completionRequestFnsRef = useLatestRef<CompletionRequestFns>({
    requestFileCompletions,
    requestPathCompletions,
  })
  const [completionDebouncer] = React.useState(createCompletionDebouncer)
  const [slashMenuState, setSlashMenuState] =
    React.useState<ComposerSlashMenuState | null>(null)
  const slashMenuStateRef = React.useRef<ComposerSlashMenuState | null>(null)
  const slashSelectionIndexRef = React.useRef(0)
  const [slashSelectionStore] = React.useState(() => createSelectionStore())
  const setSlashSelectionIndex = (next: number) => {
    slashSelectionIndexRef.current = next
    slashSelectionStore.set(next)
  }

  const refreshAssistState = () => {
    const draftText = draftTextRef.current
    const draftSkill = draftSkillRef.current
    const selection = selectionRef.current
    const nextSlashMenuState = resolveSlashMenuState({
      draftText,
      draftSkill,
      slashCommands,
    })

    if (!sameSlashMenuState(slashMenuStateRef.current, nextSlashMenuState)) {
      slashMenuStateRef.current = nextSlashMenuState
      setSlashMenuState(nextSlashMenuState)
    }

    const nextCompletionQuery = resolveCompletionQuery({
      draftText,
      selection,
    })

    if (!sameCompletionQuery(completionQueryRef.current, nextCompletionQuery)) {
      completionRequestIdRef.current += 1
      completionQueryRef.current = nextCompletionQuery
      setCompletionQuery(nextCompletionQuery)
      if (!nextCompletionQuery) {
        dispatchCompletionState({ type: "clear" })
      }
    }
  }

  React.useEffect(() => {
    refreshAssistState()
  }, [refreshAssistState])

  React.useEffect(() => {
    const current = slashSelectionIndexRef.current
    const next = slashMenuState
      ? Math.max(0, Math.min(slashMenuState.commands.length - 1, current))
      : 0

    setSlashSelectionIndex(next)
  }, [setSlashSelectionIndex, slashMenuState])

  React.useEffect(() => {
    if (!completionQuery) {
      completionRequestIdRef.current += 1
      completionDebouncer.cancel()
      dispatchCompletionState({ type: "clear" })
      return
    }

    const requestId = ++completionRequestIdRef.current

    const load = async () => {
      const result = await settle(
        loadDebouncedCompletions(
          completionDebouncer,
          completionQuery,
          completionRequestFnsRef.current
        )
      )
      if (!result.ok) {
        if (requestId === completionRequestIdRef.current) {
          dispatchCompletionState({ type: "clear" })
        }
        return
      }

      if (requestId !== completionRequestIdRef.current) return

      dispatchCompletionState({
        type: "loaded",
        query: completionQuery,
        items: result.value ?? [],
      })
    }

    void load()
  }, [completionDebouncer, completionQuery, completionRequestFnsRef])

  React.useEffect(
    () => () => {
      completionDebouncer.cancel()
      completionDebouncer.abort()
    },
    [completionDebouncer]
  )

  const dismissMenus = () => {
    completionRequestIdRef.current += 1
    completionDebouncer.cancel()
    completionQueryRef.current = null
    slashMenuStateRef.current = null
    setCompletionQuery((current) => (current ? null : current))
    dispatchCompletionState({ type: "clear" })
    setSlashMenuState((current) => (current ? null : current))
    setSlashSelectionIndex(0)
  }

  const visibleCompletion = completionState?.items.length
    ? completionState
    : null
  const selectedCompletionItem = visibleCompletion
    ? visibleCompletion.items[visibleCompletion.selectedIndex] ||
      visibleCompletion.items[0]
    : null
  const getSelectedSlashCommand = () => {
    const current = slashMenuStateRef.current
    if (!current) return null
    return (
      current.commands[slashSelectionIndexRef.current] ||
      current.commands[0] ||
      null
    )
  }

  const syncSelection = () => {
    const textarea = promptRef.current
    if (!textarea) return

    const nextSelection = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    }
    if (sameSelection(selectionRef.current, nextSelection)) return

    selectionRef.current = nextSelection
    refreshAssistState()
  }

  const setCaret = (start: number, end = start) => {
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(start, end)
      selectionRef.current = { start, end }
      refreshAssistState()
    })
  }

  const applyCompletion = (
    item: CompletionItem,
    queryArg?: ComposerCompletionQuery
  ) => {
    // Not a default parameter: the React Compiler cannot compile `?.` there.
    const query = queryArg === undefined ? visibleCompletion?.query : queryArg
    if (!query) return false
    const next = applyCompletionItem({
      value: draftTextRef.current,
      query,
      item,
    })
    const parsed = parseComposerSkillMessage(next.value)
    applyDraft(
      parsed.matched ? parsed.text : next.value,
      parsed.matched ? parsed.skillName : undefined,
      {
        selection: {
          start: next.selectionStart,
          end: next.selectionEnd,
        },
      }
    )
    dismissMenus()
    setCaret(next.selectionStart, next.selectionEnd)
    return true
  }

  const applySlashSuggestion = (command: SlashCommandDescriptor | null) => {
    if (!command) return false

    if (command.kind === "skill") {
      applyDraft("", command.skillName, {
        immediate: true,
        selection: { start: 0, end: 0 },
      })
      dismissMenus()
      requestAnimationFrame(() => promptRef.current?.focus())
      return true
    }

    const leadingWhitespace = draftTextRef.current.match(/^\s*/)?.[0] || ""
    const nextValue = `${leadingWhitespace}/${command.name} `
    const nextCaret = nextValue.length
    applyDraft(nextValue, undefined, {
      selection: { start: nextCaret, end: nextCaret },
    })
    dismissMenus()
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(nextCaret, nextCaret)
      selectionRef.current = { start: nextCaret, end: nextCaret }
      refreshAssistState()
    })
    return true
  }

  const selectCompletionIndex = (index: number) => {
    dispatchCompletionState({ type: "select", index })
  }

  const moveCompletionSelection = (direction: -1 | 1) => {
    dispatchCompletionState({ type: "move-selection", direction })
  }

  const moveSlashSelection = (direction: -1 | 1) => {
    const total = slashMenuStateRef.current?.commands.length || 0
    if (total === 0) {
      setSlashSelectionIndex(0)
      return
    }

    setSlashSelectionIndex(
      (slashSelectionIndexRef.current + direction + total) % total
    )
  }

  return {
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
    selectSlashIndex: setSlashSelectionIndex,
    moveSlashSelection,
    dismissMenus,
    refreshAssistState,
  }
}
