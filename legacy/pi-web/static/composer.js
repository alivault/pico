import { createFloatingPortal, FLOATING_PLACEMENTS } from "./floating.js"
import { clearLoader, isLoaderVisible, setLoaderActive } from "./loader.js"
import { safeLocalStorageSetItem } from "./state.js"

export function createComposerController({
  state,
  refs,
  builtinSlashCommands,
  services,
}) {
  const {
    $composerImagePreview,
    $composerSkillPill,
    $messagesWorkingIndicator,
    $messagesWorkingDone,
    $messagesWorkingLabel,
    $messagesWorkingSpinner,
    $messagesWorkingSummary,
    $messagesWorkingText,
    $modelOptions,
    $modelPopover,
    $modelSearch,
    $modelTrigger,
    $modelTriggerLabel,
    $pathCompletionMenu,
    $prompt,
    $queue,
    $send,
    $slashCommandMenu,
    $steer,
    $thinkingOptions,
    $thinkingPopover,
    $thinkingTrigger,
    $thinkingTriggerLabel,
  } = refs

  const modelPopoverPortal = createFloatingPortal($modelPopover, {
    defaultPlacement: FLOATING_PLACEMENTS.TOP_START,
    offset: 8,
    padding: 16,
  })
  const thinkingPopoverPortal = createFloatingPortal($thinkingPopover, {
    defaultPlacement: FLOATING_PLACEMENTS.TOP_START,
    offset: 8,
    padding: 16,
  })

  let workingIndicatorFrame = null
  let workingIndicatorRenderKey = ""
  let workingIndicatorRequestKey = ""
  let suppressNextWorkingIndicatorFinish = false
  let pathCompletionRequestId = 0

  const PATH_COMPLETION_DELIMITERS = new Set([" ", "\t", "\n", '"', "'", "="])

  function parseSlashCommandInput(value) {
    const rawValue = typeof value === "string" ? value : ""
    const trimmedStart = rawValue.trimStart()
    if (!trimmedStart.startsWith("/")) return null

    const afterSlash = trimmedStart.slice(1)
    const whitespaceIndex = afterSlash.search(/\s/)
    const name =
      whitespaceIndex >= 0 ? afterSlash.slice(0, whitespaceIndex) : afterSlash
    const args =
      whitespaceIndex >= 0 ? afterSlash.slice(whitespaceIndex).trim() : ""

    return {
      rawValue,
      trimmedStart,
      name,
      args,
      hasArguments: whitespaceIndex >= 0,
    }
  }

  function normalizeSlashSearchValue(value = "") {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
  }

  function isSlashSubsequenceMatch(query, target) {
    if (!query) return true
    let queryIndex = 0
    for (const char of target) {
      if (char === query[queryIndex]) {
        queryIndex += 1
        if (queryIndex >= query.length) return true
      }
    }
    return false
  }

  function availableSkillSlashCommands() {
    return state.availableSkills.map((skill) => ({
      kind: "skill",
      name: `skill:${skill.name}`,
      skillName: skill.name,
      description: skill.description || "Use this skill",
      scope: skill.scope,
      source: skill.source,
    }))
  }

  function availableBuiltinSlashCommands() {
    return builtinSlashCommands.filter((command) => {
      switch (command.name) {
        case "hide-thinking":
          return !state.hideThinkingBlock
        case "show-thinking":
          return state.hideThinkingBlock
        case "hide-tools":
          return !state.hideToolBlocks
        case "show-tools":
          return state.hideToolBlocks
        default:
          return true
      }
    })
  }

  function slashMenuCommands() {
    return [
      ...availableBuiltinSlashCommands(),
      ...availableSkillSlashCommands(),
    ]
  }

  function allSlashCommands() {
    return [...builtinSlashCommands, ...availableSkillSlashCommands()]
  }

  function slashCommandSearchCandidates(command) {
    const candidates = [command.name, command.description || ""]
    if (command.kind === "skill") {
      candidates.push(
        command.skillName || "",
        `skill${command.skillName || ""}`,
        `skills ${command.skillName || ""}`,
        formatComposerSkillName(command.skillName || "")
      )
    }
    return candidates.filter(Boolean)
  }

  function slashCommandMatchRank(command, query) {
    const rawQuery = typeof query === "string" ? query.trim().toLowerCase() : ""
    if (!rawQuery) return command.kind === "builtin" ? 0 : 10

    const normalizedQuery = normalizeSlashSearchValue(rawQuery)
    let bestRank = Number.POSITIVE_INFINITY

    for (const candidate of slashCommandSearchCandidates(command)) {
      const rawCandidate = String(candidate).toLowerCase()
      const normalizedCandidate = normalizeSlashSearchValue(rawCandidate)

      if (rawCandidate === rawQuery) {
        bestRank = Math.min(bestRank, 0)
        continue
      }
      if (rawCandidate.startsWith(rawQuery)) {
        bestRank = Math.min(bestRank, 1)
        continue
      }
      if (normalizedQuery && normalizedCandidate.startsWith(normalizedQuery)) {
        bestRank = Math.min(bestRank, 2)
        continue
      }
      if (rawCandidate.includes(rawQuery)) {
        bestRank = Math.min(bestRank, 3)
        continue
      }
      if (normalizedQuery && normalizedCandidate.includes(normalizedQuery)) {
        bestRank = Math.min(bestRank, 4)
        continue
      }
      if (
        normalizedQuery &&
        isSlashSubsequenceMatch(normalizedQuery, normalizedCandidate)
      ) {
        bestRank = Math.min(bestRank, 5)
      }
    }

    return Number.isFinite(bestRank)
      ? bestRank + (command.kind === "builtin" ? 0 : 0.1)
      : Number.POSITIVE_INFINITY
  }

  function matchingSlashCommands(query) {
    return slashMenuCommands()
      .map((command) => ({
        command,
        rank: slashCommandMatchRank(command, query),
      }))
      .filter((entry) => Number.isFinite(entry.rank))
      .sort(
        (a, b) =>
          a.rank - b.rank || a.command.name.localeCompare(b.command.name)
      )
      .map((entry) => entry.command)
  }

  function slashCommandMenuState() {
    if (state.composerSkill) return null

    const parsed = parseSlashCommandInput($prompt?.value || "")
    if (!parsed || parsed.hasArguments) return null

    const commands = matchingSlashCommands(parsed.name)
    if (!commands.length) return null

    return {
      ...parsed,
      commands,
    }
  }

  function syncSlashCommandState(menuState = slashCommandMenuState()) {
    const query = menuState?.name || ""
    if (state.slashCommandQuery !== query) {
      state.slashCommandQuery = query
      state.slashCommandIndex = 0
    }

    if (!menuState) {
      return null
    }

    state.slashCommandIndex = Math.max(
      0,
      Math.min(menuState.commands.length - 1, state.slashCommandIndex)
    )
    return menuState
  }

  function selectedSlashCommand(menuState = syncSlashCommandState()) {
    if (!menuState) return null
    return (
      menuState.commands[state.slashCommandIndex] ||
      menuState.commands[0] ||
      null
    )
  }

  function moveSlashCommandSelection(direction = 1) {
    if (document.activeElement !== $prompt) return false

    const menuState = syncSlashCommandState()
    if (!menuState?.commands?.length) return false

    const step = direction < 0 ? -1 : 1
    const total = menuState.commands.length
    state.slashCommandIndex = (state.slashCommandIndex + step + total) % total
    renderSlashCommandMenu()
    return true
  }

  function exactSlashCommand(value = $prompt?.value || "") {
    const parsed = parseSlashCommandInput(value)
    if (!parsed) return null

    const command = allSlashCommands().find(
      (entry) => entry.name === parsed.name
    )
    if (!command) return null

    return { command, args: parsed.args }
  }

  function slashCommandAction(value = $prompt?.value || "") {
    if (state.composerSkill) return null

    const exact = exactSlashCommand(value)
    if (exact) {
      if (exact.command.kind === "builtin") {
        return {
          type: "execute-builtin",
          command: exact.command,
          args: exact.args,
        }
      }
      if (!exact.args) {
        return { type: "insert-skill", skillName: exact.command.skillName }
      }
    }

    const menuState = syncSlashCommandState(slashCommandMenuState())
    const command = selectedSlashCommand(menuState)
    if (!menuState || !command) return null

    return command.kind === "builtin"
      ? { type: "execute-builtin", command, args: "" }
      : { type: "insert-skill", skillName: command.skillName }
  }

  function slashCommandQueryMatch(value = $prompt?.value || "") {
    const text = typeof value === "string" ? value : ""
    const match = text.match(/^(\s*)\/(\S*)(\s*)$/)
    if (!match) return null
    return {
      leadingWhitespace: match[1] || "",
    }
  }

  function isSlashCommandQueryActive(value = $prompt?.value || "") {
    return (
      document.activeElement === $prompt &&
      Boolean(slashCommandQueryMatch(value))
    )
  }

  function dismissSlashCommandQuery(value = $prompt?.value || "") {
    if (!$prompt || state.composerSkill) return false

    const match = slashCommandQueryMatch(value)
    if (!match) return false

    $prompt.value = match.leadingWhitespace
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()
    const caret = $prompt.value.length
    $prompt.setSelectionRange(caret, caret)
    return true
  }

  function applySlashCommandCompletion(command) {
    if (!$prompt || !command) return

    if (command.kind === "skill") {
      insertSkillCommand(command.skillName)
      return
    }

    const leadingWhitespace = $prompt.value.match(/^\s*/)?.[0] || ""
    $prompt.value = `${leadingWhitespace}/${command.name} `
    renderSlashCommandMenu()
    $prompt.focus()
    const caret = $prompt.value.length
    $prompt.setSelectionRange(caret, caret)
  }

  function findLastPathCompletionDelimiter(text = "") {
    for (let index = text.length - 1; index >= 0; index -= 1) {
      if (PATH_COMPLETION_DELIMITERS.has(text[index] || "")) {
        return index
      }
    }
    return -1
  }

  function findNextPathCompletionDelimiter(text = "", start = 0) {
    for (let index = Math.max(0, start); index < text.length; index += 1) {
      if (PATH_COMPLETION_DELIMITERS.has(text[index] || "")) {
        return index
      }
    }
    return text.length
  }

  function findUnclosedCompletionQuoteStart(text = "") {
    let inQuotes = false
    let quoteStart = -1
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '"') {
        inQuotes = !inQuotes
        if (inQuotes) {
          quoteStart = index
        }
      }
    }
    return inQuotes ? quoteStart : null
  }

  function isCompletionTokenStart(text = "", index = 0) {
    return index === 0 || PATH_COMPLETION_DELIMITERS.has(text[index - 1] || "")
  }

  function extractQuotedCompletionPrefix(text = "") {
    const quoteStart = findUnclosedCompletionQuoteStart(text)
    if (quoteStart === null) return null

    if (quoteStart > 0 && text[quoteStart - 1] === "@") {
      if (!isCompletionTokenStart(text, quoteStart - 1)) {
        return null
      }
      return text.slice(quoteStart - 1)
    }

    if (!isCompletionTokenStart(text, quoteStart)) {
      return null
    }

    return text.slice(quoteStart)
  }

  function extractAtCompletionPrefix(text = "") {
    const quotedPrefix = extractQuotedCompletionPrefix(text)
    if (quotedPrefix?.startsWith('@"')) {
      return quotedPrefix
    }

    const lastDelimiterIndex = findLastPathCompletionDelimiter(text)
    const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1
    if (text[tokenStart] === "@") {
      return text.slice(tokenStart)
    }
    return null
  }

  function parseAtCompletionPrefix(prefix = "") {
    if (prefix.startsWith('@"')) {
      return { rawPrefix: prefix.slice(2), isQuotedPrefix: true }
    }
    if (prefix.startsWith("@")) {
      return { rawPrefix: prefix.slice(1), isQuotedPrefix: false }
    }
    return { rawPrefix: prefix, isQuotedPrefix: false }
  }

  function currentPromptLineBeforeCursor(value = "", cursor = 0) {
    const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1))
    return value.slice(lineStart + 1, cursor)
  }

  function pathCompletionQuery({ force = false } = {}) {
    if (!$prompt) return null

    const value = $prompt.value || ""
    const selectionStart =
      typeof $prompt.selectionStart === "number"
        ? $prompt.selectionStart
        : value.length
    const selectionEnd =
      typeof $prompt.selectionEnd === "number"
        ? $prompt.selectionEnd
        : selectionStart
    if (selectionStart !== selectionEnd) return null

    const currentLine = currentPromptLineBeforeCursor(
      value,
      selectionStart
    ).trimStart()
    if (currentLine.startsWith("/") && !currentLine.includes(" ")) {
      return null
    }

    const textBeforeCursor = value.slice(0, selectionStart)
    const start = findLastPathCompletionDelimiter(textBeforeCursor) + 1
    const end = findNextPathCompletionDelimiter(value, selectionStart)
    const prefix = value.slice(start, selectionStart)

    if (!force) {
      const looksLikePath =
        prefix.includes("/") || prefix.startsWith(".") || prefix.startsWith("~")
      if (!looksLikePath) {
        return null
      }
    }

    return {
      kind: "path",
      value,
      selectionStart,
      selectionEnd,
      start,
      end,
      prefix,
      token: value.slice(start, end),
    }
  }

  function fileReferenceCompletionQuery() {
    if (!$prompt) return null

    const value = $prompt.value || ""
    const selectionStart =
      typeof $prompt.selectionStart === "number"
        ? $prompt.selectionStart
        : value.length
    const selectionEnd =
      typeof $prompt.selectionEnd === "number"
        ? $prompt.selectionEnd
        : selectionStart
    if (selectionStart !== selectionEnd) return null

    const textBeforeCursor = value.slice(0, selectionStart)
    const prefix = extractAtCompletionPrefix(textBeforeCursor)
    if (!prefix) return null

    const start = selectionStart - prefix.length
    const afterCursor = value.slice(selectionStart)
    const end = prefix.startsWith('@"')
      ? (() => {
          const closingQuoteIndex = afterCursor.indexOf('"')
          return closingQuoteIndex >= 0
            ? selectionStart + closingQuoteIndex + 1
            : selectionStart
        })()
      : findNextPathCompletionDelimiter(value, selectionStart)
    const parsedPrefix = parseAtCompletionPrefix(prefix)

    return {
      kind: "file-reference",
      value,
      selectionStart,
      selectionEnd,
      start,
      end,
      prefix,
      rawPrefix: parsedPrefix.rawPrefix,
      isQuotedPrefix: parsedPrefix.isQuotedPrefix,
      token: value.slice(start, end),
    }
  }

  function currentOpenCompletionQuery(completion = state.pathCompletion) {
    if (!completion) return null
    return completion.kind === "file-reference"
      ? fileReferenceCompletionQuery()
      : pathCompletionQuery({ force: true })
  }

  function samePathCompletionContext(left, right) {
    if (!left || !right) return false
    return (
      left.kind === right.kind &&
      left.start === right.start &&
      left.end === right.end &&
      left.prefix === right.prefix
    )
  }

  function isPathCompletionOpen() {
    return (
      Array.isArray(state.pathCompletion?.items) &&
      state.pathCompletion.items.length > 0
    )
  }

  function activePathCompletionItem(completion = state.pathCompletion) {
    if (!Array.isArray(completion?.items) || completion.items.length === 0)
      return null
    const selectedIndex = Math.max(
      0,
      Math.min(completion.items.length - 1, completion.selectedIndex || 0)
    )
    return completion.items[selectedIndex] || completion.items[0] || null
  }

  function dismissPathCompletion({ keepRequest = false } = {}) {
    if (!keepRequest) {
      pathCompletionRequestId += 1
    }
    const hadCompletion = Boolean(state.pathCompletion)
    state.pathCompletion = null
    renderPathCompletionMenu()
    return hadCompletion
  }

  function renderPathCompletionMenu() {
    if (!$pathCompletionMenu) return

    const completion = state.pathCompletion
    const items = Array.isArray(completion?.items) ? completion.items : []
    const visible = items.length > 0

    $pathCompletionMenu.classList.toggle("hidden", !visible)
    $pathCompletionMenu.innerHTML = ""

    if (!visible) return

    let activeButton = null

    for (const [index, item] of items.entries()) {
      const button = document.createElement("button")
      const selected = index === (completion.selectedIndex || 0)
      const displayLabel = item.label || item.value || ""
      const displayPath = item.value || displayLabel
      const descriptionHtml = item.description
        ? `<span class="path-completion-item-description">${services.escapeHtml(item.description)}</span>`
        : ""
      button.type = "button"
      button.className = `path-completion-item${selected ? " active" : ""}`
      button.setAttribute("role", "option")
      button.setAttribute("aria-selected", selected ? "true" : "false")
      button.title = displayPath
      button.innerHTML = `<span class="path-completion-item-main"><span class="path-completion-item-title">${services.escapeHtml(displayLabel)}</span>${descriptionHtml}</span>`
      button.addEventListener("mousemove", () => {
        if (
          !state.pathCompletion ||
          state.pathCompletion.selectedIndex === index
        )
          return
        state.pathCompletion.selectedIndex = index
        renderPathCompletionMenu()
      })
      button.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        applyPathCompletion(item, completion)
      })
      if (selected) {
        activeButton = button
      }
      $pathCompletionMenu.appendChild(button)
    }

    const summary = document.createElement("div")
    summary.className = "path-completion-summary"
    summary.textContent = `${(completion.selectedIndex || 0) + 1}/${completion.totalCount || items.length}`
    $pathCompletionMenu.appendChild(summary)

    activeButton?.scrollIntoView({ block: "nearest" })
  }

  function movePathCompletionSelection(direction = 1) {
    if (!isPathCompletionOpen()) return false

    const activeElement = document.activeElement
    if (
      activeElement !== $prompt &&
      !$pathCompletionMenu?.contains(activeElement)
    ) {
      return false
    }

    const step = direction < 0 ? -1 : 1
    const total = state.pathCompletion.items.length
    state.pathCompletion.selectedIndex =
      (state.pathCompletion.selectedIndex + step + total) % total
    renderPathCompletionMenu()
    return true
  }

  function applyPathCompletion(item, completion = state.pathCompletion) {
    if (!$prompt || !completion || !item?.value) return false

    const currentValue = $prompt.value || ""
    const before = currentValue.slice(0, completion.start)
    const after = currentValue.slice(completion.end)
    const suffix =
      completion.kind === "file-reference" && !item.isDirectory ? " " : ""
    $prompt.value = `${before}${item.value}${suffix}${after}`
    const hasTrailingQuote = item.value.endsWith('"')
    const cursorOffset =
      item.isDirectory && hasTrailingQuote
        ? item.value.length - 1
        : item.value.length
    const caret = before.length + cursorOffset + suffix.length
    $prompt.focus()
    $prompt.setSelectionRange(caret, caret)
    state.pathCompletion = null
    renderPathCompletionMenu()
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()
    return true
  }

  function acceptSelectedPathCompletion() {
    if (!$prompt || !isPathCompletionOpen()) return false

    const currentQuery = currentOpenCompletionQuery()
    if (!samePathCompletionContext(currentQuery, state.pathCompletion)) {
      return false
    }

    const item = activePathCompletionItem()
    if (!item) return false
    return applyPathCompletion(item)
  }

  async function requestPathCompletion({
    force = false,
    acceptSingle = false,
  } = {}) {
    if (!$prompt || document.activeElement !== $prompt) return false

    const query = pathCompletionQuery({ force })
    if (!query) {
      dismissPathCompletion()
      return false
    }

    const requestId = ++pathCompletionRequestId
    const anchorValue = query.value
    const anchorSelectionStart = query.selectionStart
    const anchorSelectionEnd = query.selectionEnd

    let response
    try {
      response = await services.post("/api/path-completions", {
        prefix: query.prefix,
      })
    } catch {
      if (requestId === pathCompletionRequestId) {
        dismissPathCompletion({ keepRequest: true })
      }
      return false
    }

    if (requestId !== pathCompletionRequestId) return false
    if (($prompt.value || "") !== anchorValue) return false
    if (
      ($prompt.selectionStart ?? anchorSelectionStart) !== anchorSelectionStart
    )
      return false
    if (($prompt.selectionEnd ?? anchorSelectionEnd) !== anchorSelectionEnd)
      return false

    const items = Array.isArray(response?.items)
      ? response.items.filter(
          (item) => item && typeof item.value === "string" && item.value
        )
      : []

    if (items.length === 0) {
      dismissPathCompletion({ keepRequest: true })
      return false
    }

    if (acceptSingle && items.length === 1) {
      return applyPathCompletion(items[0], query)
    }

    const previousSelection =
      state.pathCompletion?.kind === query.kind
        ? activePathCompletionItem()
        : null
    const selectedIndex = previousSelection
      ? Math.max(
          0,
          items.findIndex((item) => item.value === previousSelection.value)
        )
      : 0

    state.pathCompletion = {
      kind: query.kind,
      start: query.start,
      end: query.end,
      prefix: query.prefix,
      items,
      totalCount: Number.isInteger(response?.totalCount)
        ? response.totalCount
        : items.length,
      selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
    }
    renderPathCompletionMenu()
    return true
  }

  async function requestFileReferenceCompletion({ acceptSingle = false } = {}) {
    if (!$prompt || document.activeElement !== $prompt) return false

    const query = fileReferenceCompletionQuery()
    if (!query) {
      if (state.pathCompletion?.kind === "file-reference") {
        dismissPathCompletion()
      }
      return false
    }

    const requestId = ++pathCompletionRequestId
    const anchorValue = query.value
    const anchorSelectionStart = query.selectionStart
    const anchorSelectionEnd = query.selectionEnd

    let response
    try {
      response = await services.post("/api/file-completions", {
        query: query.rawPrefix,
        isQuotedPrefix: query.isQuotedPrefix,
      })
    } catch {
      if (requestId === pathCompletionRequestId) {
        dismissPathCompletion({ keepRequest: true })
      }
      return false
    }

    if (requestId !== pathCompletionRequestId) return false
    if (($prompt.value || "") !== anchorValue) return false
    if (
      ($prompt.selectionStart ?? anchorSelectionStart) !== anchorSelectionStart
    )
      return false
    if (($prompt.selectionEnd ?? anchorSelectionEnd) !== anchorSelectionEnd)
      return false

    const items = Array.isArray(response?.items)
      ? response.items.filter(
          (item) => item && typeof item.value === "string" && item.value
        )
      : []

    if (items.length === 0) {
      dismissPathCompletion({ keepRequest: true })
      return false
    }

    if (acceptSingle && items.length === 1) {
      return applyPathCompletion(items[0], query)
    }

    const previousSelection =
      state.pathCompletion?.kind === query.kind
        ? activePathCompletionItem()
        : null
    const selectedIndex = previousSelection
      ? Math.max(
          0,
          items.findIndex((item) => item.value === previousSelection.value)
        )
      : 0

    state.pathCompletion = {
      kind: query.kind,
      start: query.start,
      end: query.end,
      prefix: query.prefix,
      items,
      totalCount: Number.isInteger(response?.totalCount)
        ? response.totalCount
        : items.length,
      selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
    }
    renderPathCompletionMenu()
    return true
  }

  function handleComposerInputChange() {
    maybeCollapseComposerSkillFromPrompt()
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()

    if (fileReferenceCompletionQuery()) {
      void requestFileReferenceCompletion()
      return
    }

    if (state.pathCompletion?.kind === "file-reference") {
      dismissPathCompletion()
      return
    }

    if (state.pathCompletion?.kind === "path") {
      void requestPathCompletion({ force: false, acceptSingle: false })
    }
  }

  function parseComposerSkillMessage(value = "") {
    const text = typeof value === "string" ? value : ""
    const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/)
    if (!match) {
      return { matched: false, skillName: undefined, text }
    }
    return {
      matched: true,
      skillName: match[1] || undefined,
      text: match[2] || "",
    }
  }

  function formatComposerSkillName(skillName = "") {
    return skillName
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => {
        if (part.length <= 3) return part.toUpperCase()
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(" ")
  }

  function composerDraftValue() {
    const text = $prompt?.value || ""
    if (!state.composerSkill) {
      return text
    }
    return text
      ? `/skill:${state.composerSkill} ${text}`
      : `/skill:${state.composerSkill}`
  }

  function rememberComposerDraft(sessionLike = state) {
    services.rememberPromptDraft(
      services.composerDraftOwner(sessionLike),
      composerDraftValue()
    )
  }

  function clearComposerSkill({ focusPrompt = false } = {}) {
    if (!state.composerSkill) return
    state.composerSkill = undefined
    renderComposerSkillPill()
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()
    if (focusPrompt && services.shouldRestorePromptFocus()) {
      services.focusPromptField()
    }
  }

  function renderComposerSkillPill() {
    if (!$composerSkillPill) return

    const skillName = state.composerSkill
    const visible = Boolean(skillName)
    $composerSkillPill.classList.toggle("hidden", !visible)
    $composerSkillPill.innerHTML = ""
    $composerSkillPill.title = visible ? `Skill: ${skillName}` : ""

    if (!visible) return

    const label = document.createElement("span")
    label.className = "composer-skill-pill-label"
    label.textContent = `Skill: ${formatComposerSkillName(skillName)}`

    const removeButton = document.createElement("button")
    removeButton.type = "button"
    removeButton.className = "composer-skill-pill-remove"
    removeButton.setAttribute(
      "aria-label",
      `Remove skill ${formatComposerSkillName(skillName)}`
    )
    removeButton.title = "Remove skill"
    removeButton.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
    removeButton.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      clearComposerSkill({ focusPrompt: true })
    })

    $composerSkillPill.append(label, removeButton)
  }

  function setComposerText(value = "") {
    const parsed = parseComposerSkillMessage(value)
    state.composerSkill = parsed.matched ? parsed.skillName : undefined
    if ($prompt) {
      $prompt.value = parsed.matched
        ? parsed.text
        : typeof value === "string"
          ? value
          : ""
    }
    dismissPathCompletion()
    renderComposerSkillPill()
  }

  function maybeCollapseComposerSkillFromPrompt() {
    if (!$prompt || state.composerSkill) return false

    const parsed = parseComposerSkillMessage($prompt.value)
    if (!parsed.matched || !parsed.skillName) return false

    state.composerSkill = parsed.skillName
    $prompt.value = parsed.text
    renderComposerSkillPill()
    return true
  }

  function createComposerImageId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID()
    }
    return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }

  function createClientMessageId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID()
    }
    return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }

  function previewUrlForImage(image) {
    return `data:${image.mimeType};base64,${image.data}`
  }

  function normalizePromptImage(image) {
    if (!image || typeof image !== "object") return null

    let mimeType =
      typeof image.mimeType === "string" ? image.mimeType.trim() : ""
    let data = typeof image.data === "string" ? image.data.trim() : ""

    if (!data) return null

    const dataUrlMatch = data.match(/^data:([^;,]+);base64,(.+)$/i)
    if (dataUrlMatch) {
      if (!mimeType) mimeType = dataUrlMatch[1] || mimeType
      data = dataUrlMatch[2] || ""
    }

    if (!mimeType || !/^image\//i.test(mimeType) || !data) return null

    return {
      type: "image",
      mimeType,
      data,
      previewUrl: previewUrlForImage({ mimeType, data }),
    }
  }

  function createComposerImage(image) {
    const normalized = normalizePromptImage(image)
    if (!normalized) return null
    return {
      id: createComposerImageId(),
      ...normalized,
    }
  }

  function extractMessageImages(message) {
    if (!Array.isArray(message?.content)) return []
    return message.content
      .filter((part) => part?.type === "image")
      .map((part) => normalizePromptImage(part))
      .filter(Boolean)
  }

  function clearComposerImages() {
    if (state.composerImages.length === 0) return
    state.composerImages = []
    renderComposerImages()
  }

  function renderComposerImages() {
    if (!$composerImagePreview) return

    const composerLocked =
      services.isSessionLoading() && !services.canEditComposerWhileLoading()
    $composerImagePreview.innerHTML = ""
    $composerImagePreview.classList.toggle(
      "hidden",
      composerLocked || state.composerImages.length === 0
    )
    renderSendButton()
    if (composerLocked) return

    for (const image of state.composerImages) {
      const chip = document.createElement("div")
      chip.className = "composer-image-chip"

      const preview = document.createElement("img")
      preview.src = image.previewUrl
      preview.alt = "Pasted image preview"
      preview.loading = "lazy"

      const remove = document.createElement("button")
      remove.type = "button"
      remove.className = "composer-image-remove"
      remove.setAttribute("aria-label", "Remove pasted image")
      remove.textContent = "×"
      remove.addEventListener("click", () => {
        state.composerImages = state.composerImages.filter(
          (entry) => entry.id !== image.id
        )
        renderComposerImages()
        $prompt?.focus()
      })

      chip.append(preview, remove)
      $composerImagePreview.appendChild(chip)
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result)
          return
        }
        reject(new Error("Clipboard image could not be read."))
      }
      reader.onerror = () =>
        reject(new Error("Clipboard image could not be read."))
      reader.readAsDataURL(file)
    })
  }

  async function readClipboardImages(clipboardData) {
    if (!clipboardData?.items?.length) return []

    const files = Array.from(clipboardData.items)
      .filter((item) => item.kind === "file" && /^image\//i.test(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean)

    const results = await Promise.all(
      files.map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file)
        return createComposerImage({ mimeType: file.type, data: dataUrl })
      })
    )

    return results.filter(Boolean)
  }

  function focusComposerPopover(name) {
    if (name !== "model" || services.isMobileViewport?.()) return
    requestAnimationFrame(() => {
      try {
        $modelSearch?.focus({ preventScroll: true })
      } catch {
        $modelSearch?.focus()
      }
      $modelSearch?.select()
    })
  }

  function openModelMenu() {
    if (services.isSessionLoading() || state.availableModels.length === 0)
      return false
    services.closeCommandPalette?.({ focusPrompt: false })
    services.closeDirectoryDialog?.({ focusPrompt: false })
    services.closeStatusDialog?.({ focusPrompt: false })
    services.closeSettingsDialog?.({ focusPrompt: false })
    services.closeHeaderSessionMenu?.()
    services.closeSessionMenu?.()
    services.closeDirectoryMenu?.()
    state.openComposerPopover = "model"
    renderComposerControls()
    focusComposerPopover("model")
    return true
  }

  function setComposerPopover(name) {
    state.openComposerPopover = state.openComposerPopover === name ? null : name
    renderComposerControls()
    if (state.openComposerPopover) {
      focusComposerPopover(state.openComposerPopover)
    }
  }

  function closeComposerPopovers() {
    if (!state.openComposerPopover) return
    state.openComposerPopover = null
    renderComposerControls()
  }

  function renderSlashCommandMenu() {
    if (!$slashCommandMenu) return
    if (services.isSessionLoading()) {
      $slashCommandMenu.classList.add("hidden")
      $slashCommandMenu.innerHTML = ""
      return
    }

    const menuState = syncSlashCommandState()
    $slashCommandMenu.classList.toggle("hidden", !menuState)
    $slashCommandMenu.innerHTML = ""

    if (!menuState) return

    let activeButton = null

    for (const [index, command] of menuState.commands.entries()) {
      const button = document.createElement("button")
      const selected = index === state.slashCommandIndex
      const descriptionHtml =
        command.kind === "builtin" && command.description
          ? `<span class="slash-command-item-description">${services.escapeHtml(command.description)}</span>`
          : ""
      button.type = "button"
      button.className = `slash-command-item${selected ? " active" : ""}`
      button.setAttribute("role", "option")
      button.setAttribute("aria-selected", selected ? "true" : "false")
      button.innerHTML = `<span class="slash-command-item-main"><span class="slash-command-item-title">/${services.escapeHtml(command.name)}</span>${descriptionHtml}</span>`
      button.addEventListener("mousemove", () => {
        if (state.slashCommandIndex === index) return
        state.slashCommandIndex = index
        renderSlashCommandMenu()
      })
      button.addEventListener("click", async () => {
        if (command.kind === "builtin") {
          await submitBuiltinSlashCommand(command, "")
          return
        }
        insertSkillCommand(command.skillName)
      })
      if (selected) {
        activeButton = button
      }
      $slashCommandMenu.appendChild(button)
    }

    activeButton?.scrollIntoView({ block: "nearest" })
  }

  function renderComposerControls() {
    const sessionLoading = services.isSessionLoading()
    const currentModel = state.model
    const models = filterModels(state.availableModels, state.modelSearch)
    const groupedModels = groupModels(models)
    const thinkingLevels = state.availableThinkingLevels.length
      ? state.availableThinkingLevels
      : ["off"]

    if ($modelTriggerLabel) {
      $modelTriggerLabel.textContent = currentModel?.name || "Select model"
    }

    if ($thinkingTriggerLabel) {
      $thinkingTriggerLabel.textContent = state.thinkingLevel || "off"
    }

    if ($modelTrigger) {
      const disabled = sessionLoading || state.availableModels.length === 0
      $modelTrigger.disabled = disabled
      $modelTrigger.setAttribute(
        "aria-expanded",
        state.openComposerPopover === "model" ? "true" : "false"
      )
      $modelTrigger.classList.toggle(
        "is-open",
        state.openComposerPopover === "model"
      )
    }

    if ($thinkingTrigger) {
      const disabled = sessionLoading || thinkingLevels.length === 0
      $thinkingTrigger.disabled = disabled
      $thinkingTrigger.setAttribute(
        "aria-expanded",
        state.openComposerPopover === "thinking" ? "true" : "false"
      )
      $thinkingTrigger.classList.toggle(
        "is-open",
        state.openComposerPopover === "thinking"
      )
    }

    const modelPopoverOpen = state.openComposerPopover === "model"
    const thinkingPopoverOpen = state.openComposerPopover === "thinking"

    if ($modelPopover) {
      $modelPopover.classList.toggle("hidden", !modelPopoverOpen)
    }

    if ($thinkingPopover) {
      $thinkingPopover.classList.toggle("hidden", !thinkingPopoverOpen)
    }

    if ($modelSearch && $modelSearch.value !== state.modelSearch) {
      $modelSearch.value = state.modelSearch
    }

    if ($modelOptions) {
      $modelOptions.innerHTML = ""

      if (!groupedModels.length) {
        const empty = document.createElement("div")
        empty.className = "composer-empty-state"
        empty.textContent = state.availableModels.length
          ? "No models match your search."
          : "No models are available."
        $modelOptions.appendChild(empty)
      } else {
        for (const group of groupedModels) {
          const heading = document.createElement("div")
          heading.className = "composer-option-group-label"
          heading.textContent = group.provider
          $modelOptions.appendChild(heading)

          for (const model of group.models) {
            const option = document.createElement("button")
            option.type = "button"
            option.className = `composer-option${isCurrentModel(model) ? " active" : ""}`
            option.setAttribute("role", "option")
            option.setAttribute(
              "aria-selected",
              isCurrentModel(model) ? "true" : "false"
            )
            option.innerHTML = `
              <span class="composer-option-main">
                <span class="composer-option-title">${services.escapeHtml(model.name)}</span>
              </span>
              <span class="composer-option-check" aria-hidden="true">${isCurrentModel(model) ? "✓" : ""}</span>
            `
            option.addEventListener("click", () => {
              void selectModel(model.provider, model.id)
            })
            $modelOptions.appendChild(option)
          }
        }
      }
    }

    if ($thinkingOptions) {
      $thinkingOptions.innerHTML = ""
      for (const level of thinkingLevels) {
        const option = document.createElement("button")
        option.type = "button"
        option.className = `composer-option${level === state.thinkingLevel ? " active" : ""}`
        option.setAttribute("role", "option")
        option.setAttribute(
          "aria-selected",
          level === state.thinkingLevel ? "true" : "false"
        )
        option.innerHTML = `
          <span class="composer-option-main">
            <span class="composer-option-text">
              <span class="composer-option-title">${services.escapeHtml(thinkingLabel(level))}</span>
            </span>
          </span>
          <span class="composer-option-check" aria-hidden="true">${level === state.thinkingLevel ? "✓" : ""}</span>
        `
        option.addEventListener("click", () => {
          void selectThinkingLevel(level)
        })
        $thinkingOptions.appendChild(option)
      }
    }

    if (modelPopoverOpen && $modelTrigger) {
      modelPopoverPortal.show($modelTrigger, {
        placement: FLOATING_PLACEMENTS.TOP_START,
      })
    } else {
      modelPopoverPortal.hide()
    }

    if (thinkingPopoverOpen && $thinkingTrigger) {
      thinkingPopoverPortal.show($thinkingTrigger, {
        placement: FLOATING_PLACEMENTS.TOP_START,
      })
    } else {
      thinkingPopoverPortal.hide()
    }
  }

  function filterModels(models, search) {
    const query = search.trim().toLowerCase()
    if (!query) return [...models].sort(compareModels)
    return [...models]
      .filter((model) => {
        const haystack =
          `${model.name} ${model.id} ${model.provider}`.toLowerCase()
        return haystack.includes(query)
      })
      .sort(compareModels)
  }

  function groupModels(models) {
    const groups = new Map()
    for (const model of models) {
      if (!groups.has(model.provider)) {
        groups.set(model.provider, [])
      }
      groups.get(model.provider).push(model)
    }
    return Array.from(groups.entries()).map(([provider, providerModels]) => ({
      provider,
      models: providerModels,
    }))
  }

  function compareModels(a, b) {
    return (
      a.provider.localeCompare(b.provider) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    )
  }

  function isCurrentModel(model) {
    return Boolean(
      state.model &&
      state.model.provider === model.provider &&
      state.model.id === model.id
    )
  }

  function thinkingLabel(level) {
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

  async function selectModel(provider, modelId) {
    closeComposerPopovers()
    try {
      await services.post("/api/model", { provider, modelId })
    } catch (error) {
      services.showToast(error.message, "error")
    }
  }

  async function selectThinkingLevel(level) {
    closeComposerPopovers()
    try {
      await services.post("/api/thinking", { level })
    } catch (error) {
      services.showToast(error.message, "error")
    }
  }

  async function setThinkingVisibility(hide) {
    closeComposerPopovers()
    const nextHide = Boolean(hide)
    if (state.hideThinkingBlock === nextHide) return
    await services.post("/api/settings/hide-thinking", { hide: nextHide })
    state.hideThinkingBlock = nextHide
    services.renderMessages({ force: true })
    renderWorkingIndicator()
    services.renderHeaderSessionActions()
    if (state.commandPaletteOpen) {
      services.renderCommandPalette()
    }
    services.showToast(nextHide ? "Thinking hidden" : "Thinking shown")
  }

  async function toggleThinkingVisibility() {
    try {
      await setThinkingVisibility(!state.hideThinkingBlock)
    } catch (error) {
      services.showToast(error.message, "error")
    }
  }

  async function cycleThinkingLevel(direction = 1) {
    const levels = state.availableThinkingLevels.length
      ? state.availableThinkingLevels
      : ["off"]
    if (!levels.length) return
    const currentIndex = levels.indexOf(state.thinkingLevel || "off")
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const step = direction < 0 ? -1 : 1
    const nextLevel =
      levels[(safeIndex + step + levels.length) % levels.length] || levels[0]
    await selectThinkingLevel(nextLevel)
  }

  function setToolVisibility(hide) {
    const nextHide = Boolean(hide)
    if (state.hideToolBlocks === nextHide) return
    state.hideToolBlocks = nextHide
    safeLocalStorageSetItem("pi-web-hide-tools", nextHide ? "1" : "0")
    services.renderMessages({ force: true })
    services.renderHeaderSessionActions()
    if (state.commandPaletteOpen) {
      services.renderCommandPalette()
    }
    services.showToast(nextHide ? "Tools hidden" : "Tools shown")
  }

  function toggleToolVisibility() {
    setToolVisibility(!state.hideToolBlocks)
  }

  function thinkingVisibilityLabel() {
    return state.hideThinkingBlock ? "Show thinking" : "Hide thinking"
  }

  function toolVisibilityLabel() {
    return state.hideToolBlocks ? "Show tools" : "Hide tools"
  }

  function composerHasSubmittableContent() {
    const message = composerDraftValue().trim()
    return Boolean(message) || state.composerImages.length > 0
  }

  function renderSendButton() {
    if (!$send) return
    const sessionLoading = services.isSessionLoading()
    const streaming = !sessionLoading && state.streaming
    const acceptFollowUps =
      !sessionLoading && (state.streaming || state.awaitingFirstTurn)
    const hasSubmittableContent = composerHasSubmittableContent()
    const canSubmitPrompt = !sessionLoading && hasSubmittableContent
    const canQueueDraftPrompt =
      sessionLoading &&
      services.canEditComposerWhileLoading() &&
      hasSubmittableContent
    if ($queue) {
      $queue.classList.toggle("hidden", !acceptFollowUps)
      $queue.disabled = !canSubmitPrompt
    }
    if ($steer) {
      $steer.classList.toggle("hidden", !acceptFollowUps)
      $steer.disabled = !canSubmitPrompt
    }
    $send.disabled = !streaming && !canSubmitPrompt && !canQueueDraftPrompt
    $send.classList.toggle("is-stop", streaming)
    const sendLabel = streaming
      ? "Stop response"
      : state.pendingDraftPrompt && sessionLoading
        ? "Waiting for new session"
        : state.awaitingFirstTurn && !sessionLoading
          ? hasSubmittableContent
            ? "Steer prompt"
            : "Waiting for first response"
          : canQueueDraftPrompt
            ? "Send when ready"
            : "Send prompt"
    $send.setAttribute("aria-label", sendLabel)
    $send.title = sendLabel
    if (streaming) {
      $send.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="composer-send-button-icon" aria-hidden="true" focusable="false"><rect width="18" height="18" x="3" y="3" rx="2"></rect></svg><span class="composer-send-button-label">Stop</span>'
    } else {
      $send.textContent = "↑"
    }
  }

  function hideWorkingIndicatorImmediately() {
    if (workingIndicatorFrame) {
      cancelAnimationFrame(workingIndicatorFrame)
      workingIndicatorFrame = null
    }
    suppressNextWorkingIndicatorFinish = false
    workingIndicatorRequestKey = "hidden"
    const didChange =
      workingIndicatorRenderKey !== "hidden" ||
      !$messagesWorkingIndicator?.classList.contains("hidden") ||
      $messagesWorkingIndicator?.classList.contains("has-summary") ||
      $messagesWorkingIndicator?.classList.contains("has-visible-text") ||
      $messagesWorkingIndicator?.classList.contains("is-done") ||
      !$messagesWorkingDone?.classList.contains("hidden") ||
      !$messagesWorkingSummary?.classList.contains("hidden") ||
      Boolean($messagesWorkingSummary?.textContent) ||
      !$messagesWorkingText?.classList.contains("hidden") ||
      Boolean($messagesWorkingText?.textContent) ||
      $messagesWorkingLabel?.textContent !== "Working..."
    workingIndicatorRenderKey = "hidden"
    if (
      !$messagesWorkingIndicator ||
      !$messagesWorkingDone ||
      !$messagesWorkingLabel ||
      !$messagesWorkingSummary ||
      !$messagesWorkingText
    )
      return
    clearLoader($messagesWorkingSpinner)
    $messagesWorkingIndicator.classList.add("hidden")
    $messagesWorkingIndicator.classList.remove(
      "has-summary",
      "has-visible-text",
      "is-done"
    )
    $messagesWorkingIndicator.setAttribute("aria-hidden", "true")
    $messagesWorkingDone.classList.add("hidden")
    $messagesWorkingSummary.classList.add("hidden")
    $messagesWorkingSummary.textContent = ""
    $messagesWorkingText.classList.add("hidden")
    $messagesWorkingText.textContent = ""
    $messagesWorkingLabel.textContent = "Working..."
    if (didChange) {
      services.renderScrollToBottomButton?.()
    }
  }

  function hasCompletedAssistantMessageInSession() {
    if (services.isSessionLoading()) return false
    const items = Array.isArray(state.items) ? state.items : []
    return items.some((item) => {
      if (item?.kind !== "assistant" || item.streaming || item.syntheticAbort)
        return false
      const blocks = Array.isArray(item.blocks) ? item.blocks : []
      return blocks.some((block) => {
        if (block?.type === "tool") return true
        if (block?.type !== "text") return false
        const text =
          typeof block.visibleText === "string"
            ? block.visibleText
            : typeof block.text === "string"
              ? block.text
              : ""
        return Boolean(text.trim())
      })
    })
  }

  function currentWorkingIndicatorState() {
    const sessionLoading = services.isSessionLoading()
    const workingMessage =
      typeof state.uiState?.workingMessage === "string"
        ? state.uiState.workingMessage.trim()
        : ""
    const draftPromptLabel =
      state.pendingDraftPrompt && sessionLoading
        ? "Waiting for new session..."
        : ""
    const firstTurnLabel =
      !sessionLoading && state.awaitingFirstTurn && !state.streaming
        ? "Waiting for first response..."
        : ""
    const slashCommandLabel =
      state.cancellingSlashCommand === "compact"
        ? "Cancelling compaction..."
        : state.runningSlashCommand === "compact"
          ? "Compacting context... (escape to cancel)"
          : state.runningSlashCommand
            ? `Running /${state.runningSlashCommand}…`
            : ""
    const compactionLabel =
      !slashCommandLabel && state.compacting
        ? state.compactingReason === "manual"
          ? "Compacting context... (escape to cancel)"
          : "Compacting context..."
        : ""
    const thinkingSummary =
      state.hideThinkingBlock && state.streaming
        ? state.hiddenThinkingPreview || ""
        : ""
    const visibleSummary =
      !draftPromptLabel &&
      !firstTurnLabel &&
      !slashCommandLabel &&
      !compactionLabel
        ? thinkingSummary
        : ""
    const activeLabel =
      draftPromptLabel ||
      firstTurnLabel ||
      slashCommandLabel ||
      compactionLabel ||
      (!sessionLoading && state.streaming ? workingMessage || "Working..." : "")
    const showDone =
      !sessionLoading &&
      !activeLabel &&
      !visibleSummary &&
      hasCompletedAssistantMessageInSession()
    const visibleLabel = showDone
      ? "Done"
      : slashCommandLabel || compactionLabel
    const hideImmediately =
      (suppressNextWorkingIndicatorFinish &&
        !activeLabel &&
        !visibleSummary &&
        !showDone) ||
      (!activeLabel && !visibleSummary && !showDone)

    return {
      hideImmediately,
      activeLabel,
      showDone,
      visibleLabel,
      visibleSummary,
      announcement: showDone
        ? "Done"
        : draftPromptLabel ||
          firstTurnLabel ||
          slashCommandLabel ||
          compactionLabel ||
          (visibleSummary
            ? `Thinking: ${visibleSummary}`
            : activeLabel || "Working..."),
    }
  }

  function syncWorkingIndicator() {
    workingIndicatorFrame = null
    if (
      !$messagesWorkingIndicator ||
      !$messagesWorkingDone ||
      !$messagesWorkingLabel ||
      !$messagesWorkingSummary ||
      !$messagesWorkingText
    )
      return

    const nextState = currentWorkingIndicatorState()
    if (nextState.hideImmediately) {
      hideWorkingIndicatorImmediately()
      return
    }

    if (nextState.activeLabel) {
      setLoaderActive($messagesWorkingSpinner, true)
    } else {
      clearLoader($messagesWorkingSpinner)
    }

    const loaderVisible = isLoaderVisible($messagesWorkingSpinner)
    const visible = Boolean(
      nextState.activeLabel || nextState.showDone || loaderVisible
    )
    const hasSummary = Boolean(nextState.visibleSummary)
    const hasVisibleText = Boolean(nextState.visibleLabel)
    const renderKey = JSON.stringify({
      visible,
      showDone: nextState.showDone,
      hasSummary,
      hasVisibleText,
      visibleLabel: nextState.visibleLabel,
      summary: nextState.visibleSummary,
      announcement: nextState.announcement,
      loaderVisible,
    })

    if (renderKey === workingIndicatorRenderKey) {
      return
    }
    workingIndicatorRenderKey = renderKey

    $messagesWorkingIndicator.classList.toggle("hidden", !visible)
    $messagesWorkingIndicator.classList.toggle("has-summary", hasSummary)
    $messagesWorkingIndicator.classList.toggle(
      "has-visible-text",
      hasVisibleText
    )
    $messagesWorkingIndicator.classList.toggle(
      "is-done",
      Boolean(nextState.showDone)
    )
    $messagesWorkingIndicator.setAttribute(
      "aria-hidden",
      visible ? "false" : "true"
    )
    $messagesWorkingDone.classList.toggle("hidden", !nextState.showDone)
    $messagesWorkingText.classList.toggle("hidden", !hasVisibleText)
    if ($messagesWorkingText.textContent !== nextState.visibleLabel) {
      $messagesWorkingText.textContent = nextState.visibleLabel
    }
    $messagesWorkingSummary.classList.toggle("hidden", !hasSummary)
    if ($messagesWorkingSummary.textContent !== nextState.visibleSummary) {
      $messagesWorkingSummary.textContent = nextState.visibleSummary
    }
    if ($messagesWorkingLabel.textContent !== nextState.announcement) {
      $messagesWorkingLabel.textContent = nextState.announcement
    }
    services.renderScrollToBottomButton?.()
  }

  function renderWorkingIndicator() {
    const nextState = currentWorkingIndicatorState()
    const loaderVisible = isLoaderVisible($messagesWorkingSpinner)
    const requestKey = JSON.stringify({
      hideImmediately: nextState.hideImmediately,
      activeLabel: nextState.activeLabel,
      showDone: nextState.showDone,
      visibleLabel: nextState.visibleLabel,
      visibleSummary: nextState.visibleSummary,
      announcement: nextState.announcement,
      loaderVisible,
    })

    if (!workingIndicatorFrame && requestKey === workingIndicatorRequestKey) {
      return
    }

    workingIndicatorRequestKey = requestKey
    if (nextState.hideImmediately) {
      hideWorkingIndicatorImmediately()
      return
    }
    if (workingIndicatorFrame) {
      cancelAnimationFrame(workingIndicatorFrame)
      workingIndicatorFrame = null
    }
    syncWorkingIndicator()
  }

  function suppressWorkingIndicatorFinish() {
    suppressNextWorkingIndicatorFinish = true
  }

  function resetWorkingIndicatorSuppression() {
    suppressNextWorkingIndicatorFinish = false
  }

  function applyPendingDraftPromptToComposer(pendingPrompt) {
    if (!pendingPrompt) return false
    setComposerText(pendingPrompt.message || "")
    state.composerImages = Array.isArray(pendingPrompt.images)
      ? pendingPrompt.images.map((image) => ({ ...image }))
      : []
    rememberComposerDraft(state)
    renderComposerImages()
    renderSlashCommandMenu()
    renderSendButton()
    renderWorkingIndicator()
    return true
  }

  function normalizeQueuedStreamingBehavior(streamingBehavior) {
    return streamingBehavior === "followUp" ? "followUp" : "steer"
  }

  function restorePendingDraftPrompt(ownerKey) {
    const pendingPrompt = state.pendingDraftPrompt
    if (!pendingPrompt || (ownerKey && pendingPrompt.ownerKey !== ownerKey))
      return false
    state.pendingDraftPrompt = null
    state.pendingDraftFollowUps = []
    state.awaitingFirstTurn = false
    return applyPendingDraftPromptToComposer(pendingPrompt)
  }

  function queuePendingDraftPrompt(streamingBehavior) {
    const loadingDraft = services.loadingDraftSession()
    if (!loadingDraft) return false

    const message = composerDraftValue().trim()
    const images = state.composerImages.map((image) => ({ ...image }))
    if (!message && images.length === 0) return false

    if (!state.pendingDraftPrompt) {
      state.pendingDraftPrompt = {
        ownerKey: services.promptDraftKey(loadingDraft),
        message,
        images,
        streamingBehavior,
      }
    } else {
      state.pendingDraftFollowUps.push({
        message,
        images,
        streamingBehavior: normalizeQueuedStreamingBehavior(streamingBehavior),
      })
    }

    setComposerText("")
    rememberComposerDraft(state)
    state.composerImages = []
    renderComposerImages()
    renderSlashCommandMenu()
    renderSendButton()
    renderWorkingIndicator()
    if (!state.pendingDraftFollowUps.length) {
      services.showToast(
        "Prompt will send when the new session is ready.",
        "info"
      )
    }
    return true
  }

  async function flushPendingDraftFollowUps() {
    if (services.isSessionLoading()) return false
    const pendingFollowUps = Array.isArray(state.pendingDraftFollowUps)
      ? state.pendingDraftFollowUps.map((prompt) => ({
          message: prompt?.message || "",
          images: Array.isArray(prompt?.images)
            ? prompt.images.map((image) => ({ ...image }))
            : [],
          streamingBehavior: normalizeQueuedStreamingBehavior(
            prompt?.streamingBehavior
          ),
        }))
      : []
    if (!pendingFollowUps.length) return false

    state.pendingDraftFollowUps = []
    renderSendButton()
    renderWorkingIndicator()

    for (const pendingPrompt of pendingFollowUps) {
      try {
        void services.primeSessionDoneAudio?.()
        await services.post("/api/prompt", {
          message: pendingPrompt.message,
          images: pendingPrompt.images.map((image) => ({
            type: "image",
            mimeType: image.mimeType,
            data: image.data,
          })),
          streamingBehavior: pendingPrompt.streamingBehavior,
        })
      } catch (error) {
        if (!composerDraftValue()) {
          setComposerText(pendingPrompt.message || "")
          state.composerImages = pendingPrompt.images.map((image) => ({
            ...image,
          }))
          rememberComposerDraft(state)
          renderComposerImages()
          renderSlashCommandMenu()
        }
        renderSendButton()
        renderWorkingIndicator()
        services.showToast(error.message, "error")
        return false
      }
    }

    renderSendButton()
    renderWorkingIndicator()
    return true
  }

  async function flushPendingDraftPrompt(
    ownerKey = services.promptDraftKey(state)
  ) {
    const pendingPrompt = state.pendingDraftPrompt
    if (
      !pendingPrompt ||
      pendingPrompt.ownerKey !== ownerKey ||
      services.isSessionLoading()
    )
      return false

    state.pendingDraftPrompt = null
    applyPendingDraftPromptToComposer(pendingPrompt)
    const sent = await submitPrompt(pendingPrompt.streamingBehavior)
    if (!sent) {
      state.pendingDraftFollowUps = []
      renderSendButton()
      renderWorkingIndicator()
      return false
    }
    await flushPendingDraftFollowUps()
    return true
  }

  async function submitPromptOrQueue(streamingBehavior) {
    if (services.isSessionLoading()) {
      if (!services.canEditComposerWhileLoading()) return false
      return queuePendingDraftPrompt(streamingBehavior)
    }

    return submitPrompt(streamingBehavior)
  }

  async function submitPrompt(streamingBehavior) {
    if (services.isSessionLoading()) return false

    const message = composerDraftValue().trim()
    const images = state.composerImages.map((image) => ({
      type: "image",
      mimeType: image.mimeType,
      data: image.data,
    }))
    if (!message && images.length === 0) return false

    const treatAsQueuedPrompt = Boolean(
      state.streaming || state.awaitingFirstTurn
    )
    const normalizedStreamingBehavior = treatAsQueuedPrompt
      ? normalizeQueuedStreamingBehavior(streamingBehavior)
      : streamingBehavior
    const previousValue = composerDraftValue()
    const previousImages = [...state.composerImages]

    if (!treatAsQueuedPrompt) {
      state.awaitingFirstTurn = true
    }

    const optimisticItem = !treatAsQueuedPrompt
      ? services.insertUserItem({
          kind: "user",
          clientRequestId: createClientMessageId(),
          text: message,
          images: previousImages
            .map((image) => normalizePromptImage(image))
            .filter(Boolean),
          queued: false,
          streamingBehavior: undefined,
          optimistic: true,
        })
      : null

    setComposerText("")
    rememberComposerDraft(state)
    state.composerImages = []
    renderComposerImages()
    renderSlashCommandMenu()
    renderSendButton()
    renderWorkingIndicator()

    if (!treatAsQueuedPrompt) {
      state.followMessages = true
      services.render()
    }

    try {
      void services.primeSessionDoneAudio?.()
      const payload = normalizedStreamingBehavior
        ? { message, images, streamingBehavior: normalizedStreamingBehavior }
        : { message, images }
      const result = await services.post("/api/prompt", payload)
      if (result?.queued && optimisticItem?.clientRequestId) {
        services.removeOptimisticUserItem(optimisticItem.clientRequestId)
        services.render()
      }
      renderSendButton()
      renderWorkingIndicator()
      return true
    } catch (error) {
      if (!treatAsQueuedPrompt) {
        state.awaitingFirstTurn = false
      }
      if (optimisticItem?.clientRequestId) {
        services.removeOptimisticUserItem(optimisticItem.clientRequestId)
        services.render()
      }
      if (!composerDraftValue()) {
        setComposerText(previousValue)
        renderSlashCommandMenu()
      }
      if (state.composerImages.length === 0) {
        state.composerImages = previousImages
        renderComposerImages()
      }
      rememberComposerDraft(state)
      renderSendButton()
      renderWorkingIndicator()
      services.showToast(error.message, "error")
      return false
    }
  }

  function insertSkillCommand(skillName) {
    if (!$prompt || !skillName) return

    setComposerText(`/skill:${skillName}`)
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()
    $prompt.focus()
    const caret = $prompt.value.length
    $prompt.setSelectionRange(caret, caret)
  }

  async function abortRunningSlashCommand() {
    if (state.runningSlashCommand !== "compact" || state.cancellingSlashCommand)
      return
    state.cancellingSlashCommand = state.runningSlashCommand
    renderWorkingIndicator()

    try {
      await services.post("/api/abort", {})
    } catch (error) {
      state.cancellingSlashCommand = undefined
      renderWorkingIndicator()
      services.showToast(error.message, "error")
    }
  }

  async function submitBuiltinSlashCommand(command, args) {
    if (!command || services.isSessionLoading() || state.runningSlashCommand)
      return

    if (state.composerImages.length > 0) {
      services.showToast(
        "Built-in slash commands do not support pasted images.",
        "error"
      )
      return
    }

    const previousValue = composerDraftValue()
    setComposerText("")
    rememberComposerDraft(state)
    renderSlashCommandMenu()
    renderSendButton()
    state.followMessages = true
    state.runningSlashCommand = command.name
    state.cancellingSlashCommand = undefined
    renderWorkingIndicator()

    try {
      void services.primeSessionDoneAudio?.()
      if (await services.runLocalBuiltinSlashCommand(command, args)) {
        if (services.shouldRestorePromptFocus()) {
          services.focusPromptField()
        }
        return
      }

      await services.post("/api/slash-command", {
        name: command.name,
        args: args || "",
      })
      services.showToast(`Ran /${command.name}.`, "info")
      if (services.shouldRestorePromptFocus()) {
        services.focusPromptField()
      }
    } catch (error) {
      const cancelled = state.cancellingSlashCommand === command.name
      if (cancelled) {
        services.showToast(`Cancelled /${command.name}.`, "info")
        if (services.shouldRestorePromptFocus()) {
          services.focusPromptField()
        }
      } else {
        if (!composerDraftValue()) {
          setComposerText(previousValue)
          renderSlashCommandMenu()
          renderSendButton()
        }
        rememberComposerDraft(state)
        services.showToast(error.message, "error")
      }
    } finally {
      state.runningSlashCommand = undefined
      state.cancellingSlashCommand = undefined
      renderWorkingIndicator()
    }
  }

  async function abortStreamingResponse() {
    try {
      services.suppressSessionDoneNotification?.()
      await services.post("/api/abort", {})
      const currentAssistantItem = services.getCurrentAssistantItem?.()
      if (currentAssistantItem) {
        currentAssistantItem.blocks.push({
          type: "text",
          text: "Operation aborted",
          visibleText: "Operation aborted",
          isError: true,
        })
        currentAssistantItem.streaming = false
        currentAssistantItem.syntheticAbort = true
        services.clearCurrentAssistantItem?.()
      } else {
        state.items.push({
          kind: "assistant",
          blocks: [
            {
              type: "text",
              text: "Operation aborted",
              visibleText: "Operation aborted",
              isError: true,
            },
          ],
          streaming: false,
          syntheticAbort: true,
        })
      }
      state.streaming = false
      state.hiddenThinkingPreview = undefined
      state.uiState.hiddenThinkingLabel = undefined
      hideWorkingIndicatorImmediately()
      services.render()
    } catch (error) {
      services.showToast(error.message, "error")
    }
  }

  return {
    abortRunningSlashCommand,
    abortStreamingResponse,
    acceptSelectedPathCompletion,
    applyPendingDraftPromptToComposer,
    applySlashCommandCompletion,
    clearComposerImages,
    clearComposerSkill,
    closeComposerPopovers,
    composerDraftValue,
    dismissPathCompletion,
    dismissSlashCommandQuery,
    composerHasSubmittableContent,
    createComposerImage,
    cycleThinkingLevel,
    extractMessageImages,
    flushPendingDraftPrompt,
    handleComposerInputChange,
    hideWorkingIndicatorImmediately,
    insertSkillCommand,
    isPathCompletionOpen,
    isSlashCommandQueryActive,
    maybeCollapseComposerSkillFromPrompt,
    movePathCompletionSelection,
    moveSlashCommandSelection,
    normalizePromptImage,
    openModelMenu,
    readClipboardImages,
    rememberComposerDraft,
    renderComposerControls,
    renderComposerImages,
    renderComposerSkillPill,
    renderPathCompletionMenu,
    renderSendButton,
    renderSlashCommandMenu,
    renderWorkingIndicator,
    requestFileReferenceCompletion,
    requestPathCompletion,
    selectedSlashCommand,
    syncSlashCommandState,
    resetWorkingIndicatorSuppression,
    restorePendingDraftPrompt,
    setComposerPopover,
    setComposerText,
    setThinkingVisibility,
    setToolVisibility,
    slashCommandAction,
    submitBuiltinSlashCommand,
    submitPrompt,
    submitPromptOrQueue,
    suppressWorkingIndicatorFinish,
    thinkingVisibilityLabel,
    toggleThinkingVisibility,
    toggleToolVisibility,
    toolVisibilityLabel,
  }
}
