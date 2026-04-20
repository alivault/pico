import {
  clearLoader,
  isLoaderVisible,
  mountLoaderElement,
  setLoaderActive,
} from "./loader.js"
import { renderMarkdownContent } from "./markdown.js"

export function createMessagesController({ state, refs, services }) {
  const {
    $composerFooter,
    $messages,
    $messagesWorkingIndicator,
    $pendingMessagesTray,
    $pendingMessagesTrayCount,
    $pendingMessagesTrayList,
    $pendingMessagesTrayToggle,
    $lastMessageBtn,
    $scrollToBottomBtn,
  } = refs

  let textPacerFrame = null
  let textPacerLastTick = 0
  let lastMessagesScrollTop = 0
  let lastPendingUserItemCount = 0
  let sessionLoadingStateElement = null
  let draftSessionStateElement = null
  let pendingMessageDragId = ""
  let pendingMessageDragPointerId = null
  let pendingMessageDragOverlay = null
  let pendingMessageDragOffsetX = 0
  let pendingMessageDragOffsetY = 0
  let pendingMessageDragLastClientX = 0
  let pendingMessageDragLastClientY = 0
  let pendingMessageDragInitialState = []
  let pendingMessageReordering = false
  let pendingMessageReorderRequestId = 0

  function isMessagesNearBottom(threshold = 48) {
    if (!$messages) return true
    return (
      $messages.scrollHeight - $messages.scrollTop - $messages.clientHeight <
      threshold
    )
  }

  function scheduleTextPacer() {
    if (textPacerFrame != null) return
    textPacerFrame = requestAnimationFrame(runTextPacer)
  }

  function stopTextPacer() {
    if (textPacerFrame != null) {
      cancelAnimationFrame(textPacerFrame)
      textPacerFrame = null
    }
    textPacerLastTick = 0
  }

  function hasPendingVisibleText() {
    return state.items.some(
      (item) =>
        item.kind === "assistant" &&
        item.blocks.some(
          (block) =>
            block.type === "text" &&
            (block.visibleText || "").length < (block.text || "").length
        )
    )
  }

  function runTextPacer(timestamp) {
    textPacerFrame = null
    textPacerLastTick = timestamp
    const updatedItems = new Set()

    for (const item of state.items) {
      if (item.kind !== "assistant") continue
      let itemAdvanced = false
      for (const block of item.blocks) {
        if (block.type !== "text") continue
        const fullText = block.text || ""
        const visibleText = block.visibleText || ""
        if (visibleText === fullText) continue
        block.visibleText = fullText
        itemAdvanced = true
      }
      if (itemAdvanced) {
        updatedItems.add(item)
      }
    }

    if (updatedItems.size === 1) {
      renderMessageItem(updatedItems.values().next().value)
    } else if (updatedItems.size > 1) {
      renderMessages()
    }

    if (hasPendingVisibleText()) {
      scheduleTextPacer()
    }
  }

  function flushVisibleText() {
    for (const item of state.items) {
      if (item.kind !== "assistant") continue
      for (const block of item.blocks) {
        if (block.type === "text") {
          block.visibleText = block.text || ""
        }
      }
    }
    stopTextPacer()
    textPacerLastTick = 0
  }

  function restoreMessagesScroll(previousScrollTop, shouldFollow) {
    if (!$messages) return
    if (shouldFollow) {
      $messages.scrollTop = $messages.scrollHeight
      state.followMessages = true
    } else {
      $messages.scrollTop = previousScrollTop
    }
    lastMessagesScrollTop = $messages.scrollTop
    renderScrollToBottomButton()
  }

  function renderComposerFooterShadow() {
    if (!$composerFooter) return
    const activeViewNearBottom = services.isChangesTabActive?.()
      ? (services.isChangesViewNearBottom?.(6) ?? true)
      : isMessagesNearBottom(6)
    $composerFooter.classList.toggle("has-top-shadow", !activeViewNearBottom)
  }

  function visibleMessageItems() {
    return state.items.filter((item) => !services.isPendingUserItem(item))
  }

  function assistantItemHasJumpAnchorText(item) {
    if (item?.kind !== "assistant" || item?.streaming) return false
    return (
      Array.isArray(item.blocks) &&
      item.blocks.some((block) => {
        if (block?.type !== "text") return false
        const text =
          typeof block.visibleText === "string"
            ? block.visibleText
            : typeof block.text === "string"
              ? block.text
              : ""
        return Boolean(text.trim())
      })
    )
  }

  function assistantItemJumpAnchorElement(item) {
    if (!Array.isArray(item?.blocks)) return null
    for (const block of item.blocks) {
      if (block?.type !== "text") continue
      const text =
        typeof block.visibleText === "string"
          ? block.visibleText
          : typeof block.text === "string"
            ? block.text
            : ""
      if (!text.trim()) continue
      if (block._element instanceof HTMLElement) {
        return block._element
      }
    }
    return item?._element instanceof HTMLElement ? item._element : null
  }

  function messageJumpAnchorTop(element) {
    if (!$messages || !(element instanceof HTMLElement)) return 0
    const containerRect = $messages.getBoundingClientRect()
    const targetRect = element.getBoundingClientRect()
    return $messages.scrollTop + (targetRect.top - containerRect.top)
  }

  function collectMessageJumpAnchors() {
    const items = visibleMessageItems()
    const anchors = []

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item?.kind === "user") {
        if (item._element instanceof HTMLElement) {
          anchors.push({
            element: item._element,
            top: messageJumpAnchorTop(item._element),
          })
        }
        continue
      }

      if (!assistantItemHasJumpAnchorText(item)) {
        continue
      }
      const nextItem = items[index + 1]
      if (nextItem?.kind === "assistant") {
        continue
      }
      const target = assistantItemJumpAnchorElement(item)
      if (target instanceof HTMLElement) {
        anchors.push({ element: target, top: messageJumpAnchorTop(target) })
      }
    }

    return anchors
  }

  function previousMessageJumpTarget() {
    if (!$messages || $messages.scrollTop <= 2) return null

    const anchors = collectMessageJumpAnchors()
    if (!anchors.length) return null

    const styles = window.getComputedStyle($messages)
    const paddingTop = Number.parseFloat(styles.paddingTop || "0") || 0
    const paddingBottom = Number.parseFloat(styles.paddingBottom || "0") || 0
    const viewportTop = $messages.scrollTop + paddingTop
    const viewportBottom =
      $messages.scrollTop + $messages.clientHeight - paddingBottom
    const maxScrollTop = Math.max(
      0,
      $messages.scrollHeight - $messages.clientHeight
    )
    const epsilon = 2
    const normalizeTarget = (anchor) => {
      if (!anchor) return null
      const nextScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, anchor.top - paddingTop)
      )
      if (Math.abs(nextScrollTop - $messages.scrollTop) <= epsilon) {
        return null
      }
      return { ...anchor, scrollTop: nextScrollTop }
    }

    let alignedIndex = -1
    for (let index = anchors.length - 1; index >= 0; index -= 1) {
      if (Math.abs(anchors[index].top - viewportTop) <= epsilon) {
        alignedIndex = index
        break
      }
    }
    if (alignedIndex !== -1) {
      return normalizeTarget(anchors[alignedIndex - 1])
    }

    for (let index = anchors.length - 1; index >= 0; index -= 1) {
      const anchor = anchors[index]
      if (
        anchor.top > viewportTop + epsilon &&
        anchor.top <= viewportBottom - epsilon
      ) {
        const normalizedTarget = normalizeTarget(anchor)
        if (normalizedTarget) {
          return normalizedTarget
        }
      }
    }

    for (let index = anchors.length - 1; index >= 0; index -= 1) {
      const anchor = anchors[index]
      if (anchor.top < viewportTop - epsilon) {
        const normalizedTarget = normalizeTarget(anchor)
        if (normalizedTarget) {
          return normalizedTarget
        }
      }
    }

    return null
  }

  function renderScrollToBottomButton() {
    const showScrollToBottom =
      !services.isChangesTabActive?.() &&
      !services.isSessionLoading() &&
      !isMessagesNearBottom(6)
    $scrollToBottomBtn?.classList.toggle("hidden", !showScrollToBottom)
    const showLastMessage =
      !services.isChangesTabActive?.() &&
      !services.isSessionLoading() &&
      Boolean(previousMessageJumpTarget())
    $lastMessageBtn?.classList.toggle("hidden", !showLastMessage)
    renderComposerFooterShadow()
  }

  function renderSessionLoadingState() {
    if (!sessionLoadingStateElement) {
      const wrapper = document.createElement("div")
      wrapper.className = "session-loading-state"

      const spinner = services.createCanvasLoader(
        "session-loading-state-spinner",
        { active: true }
      )

      const label = document.createElement("div")
      label.className = "session-loading-state-label"
      label.textContent = "Loading Session"

      wrapper.append(spinner, label)
      sessionLoadingStateElement = wrapper
    }

    const spinner = sessionLoadingStateElement.querySelector(
      ".session-loading-state-spinner"
    )
    mountLoaderElement(spinner)
    setLoaderActive(spinner, true)
    return sessionLoadingStateElement
  }

  function buildDraftSessionState(directoryPath) {
    const normalizedPath =
      typeof directoryPath === "string" ? directoryPath.trim() : ""
    if (normalizedPath) {
      services.ensureDirectoryGitStatus?.(normalizedPath)
    }
    return {
      title: "New session",
      directoryPath: normalizedPath,
      gitStatus: normalizedPath
        ? services.getDirectoryGitStatus?.(normalizedPath)
        : undefined,
    }
  }

  function currentDraftSessionState() {
    const loadingDraft = services.loadingDraftSession?.()
    if (loadingDraft) {
      return buildDraftSessionState(loadingDraft.cwd)
    }

    if (!state.draft) return null

    const hasVisibleMessages = state.items.some(
      (item) => !services.isPendingUserItem(item)
    )
    if (hasVisibleMessages) return null

    return buildDraftSessionState(state.cwd)
  }

  function renderDraftSessionState(viewModel) {
    if (!viewModel) return null

    if (!draftSessionStateElement) {
      const wrapper = document.createElement("section")
      wrapper.className = "draft-session-state"

      const title = document.createElement("div")
      title.className = "draft-session-state-title"

      const directory = document.createElement("div")
      directory.className = "draft-session-state-directory"

      const gitStatus = document.createElement("div")
      gitStatus.className = "draft-session-state-git"
      gitStatus.hidden = true
      gitStatus.innerHTML = `
        <span class="draft-session-state-git-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" focusable="false">
            <path d="M14.2036 7.19987L14.2079 6.69989L13.2079 6.69132L13.2036 7.1913L13.7036 7.19559L14.2036 7.19987ZM8.14804 5.09032H7.64804C7.64804 5.75797 7.06861 6.34471 6.29619 6.34471V6.84471V7.34471C7.56926 7.34471 8.64804 6.36051 8.64804 5.09032H8.14804ZM6.29619 6.84471V6.34471C5.52376 6.34471 4.94434 5.75797 4.94434 5.09032H4.44434H3.94434C3.94434 6.36051 5.02311 7.34471 6.29619 7.34471V6.84471ZM4.44434 5.09032H4.94434C4.94434 4.42267 5.52376 3.83594 6.29619 3.83594V3.33594V2.83594C5.02311 2.83594 3.94434 3.82013 3.94434 5.09032H4.44434ZM6.29619 3.33594V3.83594C7.06861 3.83594 7.64804 4.42267 7.64804 5.09032H8.14804H8.64804C8.64804 3.82013 7.56926 2.83594 6.29619 2.83594V3.33594ZM8.14804 14.9149H7.64804C7.64804 15.5825 7.06861 16.1693 6.29619 16.1693V16.6693V17.1693C7.56926 17.1693 8.64804 16.1851 8.64804 14.9149H8.14804ZM6.29619 16.6693V16.1693C5.52376 16.1693 4.94434 15.5825 4.94434 14.9149H4.44434H3.94434C3.94434 16.1851 5.02311 17.1693 6.29619 17.1693V16.6693ZM4.44434 14.9149H4.94434C4.94434 14.2472 5.52376 13.6605 6.29619 13.6605V13.1605V12.6605C5.02311 12.6605 3.94434 13.6447 3.94434 14.9149H4.44434ZM6.29619 13.1605V13.6605C7.06861 13.6605 7.64804 14.2472 7.64804 14.9149H8.14804H8.64804C8.64804 13.6447 7.56926 12.6605 6.29619 12.6605V13.1605ZM15.5554 5.09032H15.0554C15.0554 5.75797 14.476 6.34471 13.7036 6.34471V6.84471V7.34471C14.9767 7.34471 16.0554 6.36051 16.0554 5.09032H15.5554ZM13.7036 6.84471V6.34471C12.9312 6.34471 12.3517 5.75797 12.3517 5.09032H11.8517H11.3517C11.3517 6.36051 12.4305 7.34471 13.7036 7.34471V6.84471ZM11.8517 5.09032H12.3517C12.3517 4.42267 12.9312 3.83594 13.7036 3.83594V3.33594V2.83594C12.4305 2.83594 11.3517 3.82013 11.3517 5.09032H11.8517ZM13.7036 3.33594V3.83594C14.476 3.83594 15.0554 4.42267 15.0554 5.09032H15.5554H16.0554C16.0554 3.82013 14.9767 2.83594 13.7036 2.83594V3.33594ZM13.7036 7.19559L13.2036 7.1913L13.1544 12.9277L13.6544 12.932L14.1544 12.9363L14.2036 7.19987L13.7036 7.19559ZM6.29619 6.84471H5.79619V13.1605H6.29619H6.79619V6.84471H6.29619ZM11.6545 14.9149V14.4149H8.14804V14.9149V15.4149H11.6545V14.9149ZM13.6544 12.932L13.1544 12.9277C13.1474 13.7511 12.4779 14.4149 11.6545 14.4149V14.9149V15.4149C13.0269 15.4149 14.1426 14.3086 14.1544 12.9363L13.6544 12.932Z" fill="currentColor"></path>
          </svg>
        </span>
        <span class="draft-session-state-git-label"></span>
      `

      wrapper.append(title, directory, gitStatus)
      draftSessionStateElement = wrapper
    }

    const title = draftSessionStateElement.querySelector(
      ".draft-session-state-title"
    )
    const directory = draftSessionStateElement.querySelector(
      ".draft-session-state-directory"
    )
    const gitStatus = draftSessionStateElement.querySelector(
      ".draft-session-state-git"
    )
    const gitStatusLabel = draftSessionStateElement.querySelector(
      ".draft-session-state-git-label"
    )
    const directoryPath = viewModel.directoryPath || ""
    const currentGitStatus =
      viewModel.gitStatus && typeof viewModel.gitStatus === "object"
        ? viewModel.gitStatus
        : null

    if (title) {
      title.textContent = viewModel.title || "New session"
    }

    if (directory) {
      if (directoryPath) {
        directory.textContent = services.tildePath(directoryPath)
        directory.title = directoryPath
        directory.hidden = false
      } else {
        directory.textContent = ""
        directory.removeAttribute("title")
        directory.hidden = true
      }
    }

    if (gitStatus && gitStatusLabel) {
      if (currentGitStatus?.label) {
        gitStatusLabel.textContent = currentGitStatus.label
        gitStatus.title = currentGitStatus.title || currentGitStatus.label
        gitStatus.hidden = false
      } else {
        gitStatusLabel.textContent = ""
        gitStatus.removeAttribute("title")
        gitStatus.hidden = true
      }
    }

    return draftSessionStateElement
  }

  function renderMessages(options = {}) {
    if (!$messages) return
    const { force = false } = options
    const previousScrollTop = $messages.scrollTop
    const shouldFollow = state.followMessages
    const elements = []

    if (services.isBlockingSessionLoading()) {
      elements.push(renderSessionLoadingState())
    } else {
      const draftSessionState = renderDraftSessionState(
        currentDraftSessionState()
      )
      if (draftSessionState) {
        elements.push(draftSessionState)
      } else if (!services.isSessionLoading()) {
        for (const item of state.items) {
          if (services.isPendingUserItem(item)) continue
          const element = syncMessageElement(item, { force })
          if (element) {
            elements.push(element)
          }
        }

        if (state.recentCompactionSummaryItem?.kind === "assistant") {
          const recentCompactionElement = syncMessageElement(
            state.recentCompactionSummaryItem,
            { force }
          )
          if (recentCompactionElement) {
            elements.push(recentCompactionElement)
          }
        }
      }
    }

    if ($messagesWorkingIndicator) {
      elements.push($messagesWorkingIndicator)
    }

    services.syncContainerChildren($messages, elements)
    restoreMessagesScroll(previousScrollTop, shouldFollow)
  }

  function pendingUserItems() {
    return state.items.filter((item) => services.isPendingUserItem(item))
  }

  function pendingUserItemBehavior(item) {
    return item?.streamingBehavior === "steer" ? "steer" : "followUp"
  }

  function orderedPendingUserItems(items = pendingUserItems()) {
    return [
      ...items.filter((item) => pendingUserItemBehavior(item) === "steer"),
      ...items.filter((item) => pendingUserItemBehavior(item) !== "steer"),
    ]
  }

  function normalizePendingUserItemState(entries = []) {
    const steering = []
    const followUp = []
    const seenPendingIds = new Set()

    for (const entry of Array.isArray(entries) ? entries : []) {
      const pendingId =
        typeof entry?.pendingId === "string" ? entry.pendingId : ""
      if (!pendingId || seenPendingIds.has(pendingId)) continue
      seenPendingIds.add(pendingId)

      const normalizedEntry = {
        pendingId,
        streamingBehavior:
          entry?.streamingBehavior === "steer" ? "steer" : "followUp",
      }

      if (normalizedEntry.streamingBehavior === "steer") {
        steering.push(normalizedEntry)
      } else {
        followUp.push(normalizedEntry)
      }
    }

    return [...steering, ...followUp]
  }

  function pendingUserItemState(items = orderedPendingUserItems()) {
    return normalizePendingUserItemState(
      items.map((item) => ({
        pendingId: typeof item?.pendingId === "string" ? item.pendingId : "",
        streamingBehavior: pendingUserItemBehavior(item),
      }))
    )
  }

  function pendingUserItemIds(items = orderedPendingUserItems()) {
    return pendingUserItemState(items).map((item) => item.pendingId)
  }

  function pendingMessageStateEqual(left = [], right = []) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]?.pendingId !== right[index]?.pendingId) return false
      if (
        (left[index]?.streamingBehavior === "steer" ? "steer" : "followUp") !==
        (right[index]?.streamingBehavior === "steer" ? "steer" : "followUp")
      ) {
        return false
      }
    }
    return true
  }

  function pendingMessageSections(items = orderedPendingUserItems()) {
    const orderedItems = orderedPendingUserItems(items)
    return [
      {
        streamingBehavior: "steer",
        title: "Steer",
        emptyLabel: "Drag prompts here to steer the current response.",
        items: orderedItems.filter(
          (item) => pendingUserItemBehavior(item) === "steer"
        ),
      },
      {
        streamingBehavior: "followUp",
        title: "Queue",
        emptyLabel: "Drag prompts here to run them after the current response.",
        items: orderedItems.filter(
          (item) => pendingUserItemBehavior(item) !== "steer"
        ),
      },
    ]
  }

  function reorderPendingUserItemsInState(nextPendingState) {
    const pendingItems = orderedPendingUserItems()
    const currentPendingState = pendingUserItemState(pendingItems)
    const normalizedNextState = normalizePendingUserItemState(nextPendingState)
    if (
      !pendingItems.length ||
      normalizedNextState.length !== pendingItems.length
    )
      return false

    const pendingItemsById = new Map()
    for (const item of pendingItems) {
      const pendingId =
        typeof item?.pendingId === "string" ? item.pendingId : ""
      if (pendingId && !pendingItemsById.has(pendingId)) {
        pendingItemsById.set(pendingId, item)
      }
    }

    const orderedPendingItems = []
    for (const entry of normalizedNextState) {
      const item = pendingItemsById.get(entry.pendingId)
      if (!item) {
        return false
      }
      orderedPendingItems.push(item)
    }

    if (
      orderedPendingItems.every(
        (item, index) => item === pendingItems[index]
      ) &&
      pendingMessageStateEqual(currentPendingState, normalizedNextState)
    ) {
      return false
    }

    for (const [index, item] of orderedPendingItems.entries()) {
      item.streamingBehavior = normalizedNextState[index].streamingBehavior
    }

    let pendingIndex = 0
    state.items = state.items.map((item) => {
      if (!services.isPendingUserItem(item)) return item
      const nextItem = orderedPendingItems[pendingIndex]
      pendingIndex += 1
      return nextItem || item
    })
    return true
  }

  function capturePendingMessageCardPositions() {
    const positions = new Map()
    if (!$pendingMessagesTrayList) return positions

    for (const card of $pendingMessagesTrayList.querySelectorAll(
      ".pending-message-card[data-pending-id]"
    )) {
      const pendingId = card.dataset.pendingId || ""
      if (!pendingId) continue
      positions.set(pendingId, card.getBoundingClientRect().top)
    }

    return positions
  }

  function animatePendingMessageCardPositions(previousPositions = new Map()) {
    if (
      !$pendingMessagesTrayList ||
      previousPositions.size === 0 ||
      $pendingMessagesTrayList.classList.contains("hidden")
    )
      return

    for (const card of $pendingMessagesTrayList.querySelectorAll(
      ".pending-message-card[data-pending-id]"
    )) {
      if (card.classList.contains("is-drag-source")) continue
      const pendingId = card.dataset.pendingId || ""
      const previousTop = previousPositions.get(pendingId)
      if (previousTop == null) continue
      const nextTop = card.getBoundingClientRect().top
      const deltaY = previousTop - nextTop
      if (!deltaY) continue

      card.style.transition = "none"
      card.style.transform = `translateY(${deltaY}px)`
      card.getBoundingClientRect()
      requestAnimationFrame(() => {
        card.style.removeProperty("transition")
        card.style.removeProperty("transform")
      })
    }
  }

  function destroyPendingMessageDragOverlay() {
    pendingMessageDragOverlay?.remove()
    pendingMessageDragOverlay = null
  }

  function removePendingMessageDragListeners() {
    window.removeEventListener(
      "pointermove",
      handlePendingMessageDragPointerMove
    )
    window.removeEventListener("pointerup", handlePendingMessageDragPointerUp)
    window.removeEventListener(
      "pointercancel",
      handlePendingMessageDragPointerCancel
    )
    window.removeEventListener("blur", handlePendingMessageDragWindowBlur)
  }

  function applyPendingMessageDragState() {
    if (!$pendingMessagesTrayList) return

    const cards = Array.from(
      $pendingMessagesTrayList.querySelectorAll(".pending-message-card")
    )
    const hasDrag = Boolean(pendingMessageDragId)

    for (const card of cards) {
      const pendingId = card.dataset.pendingId || ""
      const isDraggedSource = hasDrag && pendingId === pendingMessageDragId
      card.classList.toggle("is-drag-source", isDraggedSource)
      card.setAttribute("aria-grabbed", isDraggedSource ? "true" : "false")
    }

    document.body.classList.toggle("pending-message-drag-active", hasDrag)
  }

  function clearPendingMessageDragState({
    restoreInitialOrder = false,
    apply = true,
  } = {}) {
    const currentPendingState = pendingUserItemState()
    const initialPendingState = normalizePendingUserItemState(
      pendingMessageDragInitialState
    )

    removePendingMessageDragListeners()
    destroyPendingMessageDragOverlay()
    document.body.classList.remove("pending-message-drag-active")

    pendingMessageDragId = ""
    pendingMessageDragPointerId = null
    pendingMessageDragOffsetX = 0
    pendingMessageDragOffsetY = 0
    pendingMessageDragLastClientX = 0
    pendingMessageDragLastClientY = 0
    pendingMessageDragInitialState = []

    if (
      restoreInitialOrder &&
      initialPendingState.length > 0 &&
      initialPendingState.length === currentPendingState.length &&
      !pendingMessageStateEqual(currentPendingState, initialPendingState)
    ) {
      reorderPendingUserItemsInState(initialPendingState)
    }

    if (apply) {
      renderPendingMessagesTray()
    } else {
      applyPendingMessageDragState()
    }
  }

  function currentPendingDropTarget(clientY) {
    const fallbackBehavior = pendingUserItemBehavior(
      pendingUserItems().find(
        (item) =>
          (typeof item?.pendingId === "string" ? item.pendingId : "") ===
          pendingMessageDragId
      )
    )

    if (!$pendingMessagesTrayList || !pendingMessageDragId) {
      return { streamingBehavior: fallbackBehavior, beforePendingId: "" }
    }

    const sections = Array.from(
      $pendingMessagesTrayList.querySelectorAll(
        ".pending-message-section[data-pending-type]"
      )
    )
    if (!sections.length) {
      return { streamingBehavior: fallbackBehavior, beforePendingId: "" }
    }

    let targetSection = sections[0]
    for (const section of sections) {
      const rect = section.getBoundingClientRect()
      if (clientY >= rect.top) {
        targetSection = section
      }
    }

    const streamingBehavior =
      targetSection.dataset.pendingType === "steer" ? "steer" : "followUp"
    const cards = Array.from(
      targetSection.querySelectorAll(".pending-message-card[data-pending-id]")
    ).filter((card) => (card.dataset.pendingId || "") !== pendingMessageDragId)

    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2
      if (clientY < midpoint) {
        return {
          streamingBehavior,
          beforePendingId: card.dataset.pendingId || "",
        }
      }
    }

    return { streamingBehavior, beforePendingId: "" }
  }

  function buildPendingUserItemState(draggedPendingId, dropTarget = {}) {
    const currentPendingState = pendingUserItemState()
    const normalizedDropTarget = {
      streamingBehavior:
        dropTarget?.streamingBehavior === "steer" ? "steer" : "followUp",
      beforePendingId:
        typeof dropTarget?.beforePendingId === "string"
          ? dropTarget.beforePendingId
          : "",
    }

    const draggedEntry = currentPendingState.find(
      (entry) => entry.pendingId === draggedPendingId
    )
    if (!draggedEntry) return null

    const remainingEntries = currentPendingState.filter(
      (entry) => entry.pendingId !== draggedPendingId
    )
    const steering = remainingEntries.filter(
      (entry) => entry.streamingBehavior === "steer"
    )
    const followUp = remainingEntries.filter(
      (entry) => entry.streamingBehavior !== "steer"
    )
    const targetEntries =
      normalizedDropTarget.streamingBehavior === "steer" ? steering : followUp

    let insertIndex = targetEntries.length
    if (normalizedDropTarget.beforePendingId) {
      const beforeIndex = targetEntries.findIndex(
        (entry) => entry.pendingId === normalizedDropTarget.beforePendingId
      )
      if (beforeIndex !== -1) {
        insertIndex = beforeIndex
      }
    }

    targetEntries.splice(insertIndex, 0, {
      pendingId: draggedPendingId,
      streamingBehavior: normalizedDropTarget.streamingBehavior,
    })

    const nextPendingState = normalizePendingUserItemState([
      ...steering,
      ...followUp,
    ])
    return pendingMessageStateEqual(currentPendingState, nextPendingState)
      ? null
      : nextPendingState
  }

  function maybeAutoScrollPendingMessagesTray(clientY) {
    if (
      !$pendingMessagesTrayList ||
      $pendingMessagesTrayList.classList.contains("hidden")
    )
      return

    const rect = $pendingMessagesTrayList.getBoundingClientRect()
    const edgeThreshold = 44
    if (clientY < rect.top + edgeThreshold) {
      const distance = rect.top + edgeThreshold - clientY
      $pendingMessagesTrayList.scrollTop -= Math.max(6, Math.ceil(distance / 3))
    } else if (clientY > rect.bottom - edgeThreshold) {
      const distance = clientY - (rect.bottom - edgeThreshold)
      $pendingMessagesTrayList.scrollTop += Math.max(6, Math.ceil(distance / 3))
    }
  }

  function positionPendingMessageDragOverlay(clientX, clientY) {
    if (!pendingMessageDragOverlay) return
    pendingMessageDragLastClientX = clientX
    pendingMessageDragLastClientY = clientY
    pendingMessageDragOverlay.style.left = `${Math.round(clientX - pendingMessageDragOffsetX)}px`
    pendingMessageDragOverlay.style.top = `${Math.round(clientY - pendingMessageDragOffsetY)}px`
  }

  function updatePendingMessageDrag(clientX, clientY) {
    if (!pendingMessageDragId) return

    positionPendingMessageDragOverlay(clientX, clientY)
    maybeAutoScrollPendingMessagesTray(clientY)

    const nextPendingState = buildPendingUserItemState(
      pendingMessageDragId,
      currentPendingDropTarget(clientY)
    )
    if (!nextPendingState) return

    reorderPendingUserItemsInState(nextPendingState)
    renderPendingMessagesTray()
  }

  async function reorderPendingMessages(nextPendingState, options = {}) {
    if (pendingMessageReordering) return false

    const normalizedNextState = normalizePendingUserItemState(nextPendingState)
    const rollbackPendingState = normalizePendingUserItemState(
      Array.isArray(options.rollbackPendingState)
        ? options.rollbackPendingState
        : pendingUserItemState()
    )
    const applyLocally = options.applyLocally !== false

    if (
      normalizedNextState.length !== rollbackPendingState.length ||
      pendingMessageStateEqual(rollbackPendingState, normalizedNextState)
    ) {
      return false
    }

    pendingMessageReordering = true
    const requestId = ++pendingMessageReorderRequestId

    if (applyLocally) {
      reorderPendingUserItemsInState(normalizedNextState)
      renderPendingMessagesTray()
    }

    try {
      await services.post("/api/pending-messages/reorder", {
        pendingMessages: normalizedNextState,
      })
      return true
    } catch (error) {
      if (requestId === pendingMessageReorderRequestId) {
        reorderPendingUserItemsInState(rollbackPendingState)
        renderPendingMessagesTray()
      }
      throw error
    } finally {
      if (requestId === pendingMessageReorderRequestId) {
        pendingMessageReordering = false
        renderPendingMessagesTray()
      }
    }
  }

  async function finishPendingMessageDrag({ commit = true } = {}) {
    if (!pendingMessageDragId) return

    const initialPendingState = normalizePendingUserItemState(
      pendingMessageDragInitialState
    )
    const finalPendingState = pendingUserItemState()
    clearPendingMessageDragState({ restoreInitialOrder: !commit, apply: true })

    if (
      !commit ||
      !initialPendingState.length ||
      pendingMessageStateEqual(initialPendingState, finalPendingState)
    ) {
      return
    }

    try {
      await reorderPendingMessages(finalPendingState, {
        applyLocally: false,
        rollbackPendingState: initialPendingState,
      })
    } catch (error) {
      services.showToast(
        error instanceof Error
          ? error.message
          : "Failed to reorder pending prompts.",
        "error"
      )
    }
  }

  function handlePendingMessageDragPointerMove(event) {
    if (
      !pendingMessageDragId ||
      event.pointerId !== pendingMessageDragPointerId
    )
      return
    event.preventDefault()
    updatePendingMessageDrag(event.clientX, event.clientY)
  }

  function handlePendingMessageDragPointerUp(event) {
    if (
      !pendingMessageDragId ||
      event.pointerId !== pendingMessageDragPointerId
    )
      return
    event.preventDefault()
    void finishPendingMessageDrag({ commit: true })
  }

  function handlePendingMessageDragPointerCancel(event) {
    if (
      !pendingMessageDragId ||
      event.pointerId !== pendingMessageDragPointerId
    )
      return
    event.preventDefault()
    void finishPendingMessageDrag({ commit: false })
  }

  function handlePendingMessageDragWindowBlur() {
    if (!pendingMessageDragId) return
    void finishPendingMessageDrag({ commit: false })
  }

  function beginPendingMessageDrag(item, card, event) {
    const pendingId = typeof item?.pendingId === "string" ? item.pendingId : ""
    const currentPendingState = pendingUserItemState()
    if (
      !pendingId ||
      pendingMessageReordering ||
      currentPendingState.length === 0
    )
      return

    const rect = card.getBoundingClientRect()
    pendingMessageDragId = pendingId
    pendingMessageDragPointerId = event.pointerId
    pendingMessageDragInitialState = [...currentPendingState]
    pendingMessageDragOffsetX = event.clientX - rect.left
    pendingMessageDragOffsetY = event.clientY - rect.top
    pendingMessageDragLastClientX = event.clientX
    pendingMessageDragLastClientY = event.clientY

    const overlay = card.cloneNode(true)
    overlay.classList.remove("is-drag-source", "is-reorder-disabled")
    overlay.classList.add("pending-message-drag-overlay")
    overlay.setAttribute("aria-hidden", "true")
    overlay.style.width = `${Math.round(rect.width)}px`
    overlay.style.height = `${Math.round(rect.height)}px`
    pendingMessageDragOverlay = overlay
    document.body.appendChild(overlay)
    positionPendingMessageDragOverlay(event.clientX, event.clientY)

    applyPendingMessageDragState()
    window.addEventListener(
      "pointermove",
      handlePendingMessageDragPointerMove,
      { passive: false }
    )
    window.addEventListener("pointerup", handlePendingMessageDragPointerUp, {
      passive: false,
    })
    window.addEventListener(
      "pointercancel",
      handlePendingMessageDragPointerCancel,
      { passive: false }
    )
    window.addEventListener("blur", handlePendingMessageDragWindowBlur)
  }

  function ensurePendingMessageDragAndDrop() {
    if (
      !$pendingMessagesTrayList ||
      $pendingMessagesTrayList.dataset.dragAndDropReady === "true"
    )
      return
    $pendingMessagesTrayList.dataset.dragAndDropReady = "true"
  }

  function renderPendingMessageSection(section, options = {}) {
    const wrapper = document.createElement("section")
    wrapper.className = "pending-message-section"
    wrapper.dataset.pendingType = section.streamingBehavior

    const header = document.createElement("div")
    header.className = "pending-message-section-header"

    const title = document.createElement("span")
    title.className = "pending-message-section-title"
    title.textContent = section.title

    const count = document.createElement("span")
    count.className = "pending-message-section-count"
    count.textContent = services.formatNumber(section.items.length)

    header.append(title, count)

    const body = document.createElement("div")
    body.className = "pending-message-section-body"

    const elements = section.items
      .map((item) => syncUserMessageElement(item, options))
      .filter(Boolean)

    if (elements.length > 0) {
      body.append(...elements)
    } else {
      const empty = document.createElement("div")
      empty.className = "pending-message-section-empty"
      empty.textContent = section.emptyLabel
      body.append(empty)
    }

    wrapper.append(header, body)
    return wrapper
  }

  function pendingMessageCountLabel(count) {
    return services.formatNumber(count)
  }

  function renderPendingMessagesTray(options = {}) {
    if (
      !$pendingMessagesTray ||
      !$pendingMessagesTrayToggle ||
      !$pendingMessagesTrayCount ||
      !$pendingMessagesTrayList
    )
      return
    ensurePendingMessageDragAndDrop()

    if (services.isSessionLoading()) {
      lastPendingUserItemCount = 0
      if (pendingMessageDragId) {
        clearPendingMessageDragState({
          restoreInitialOrder: false,
          apply: false,
        })
      }
      $pendingMessagesTray.classList.add("hidden")
      $pendingMessagesTray.classList.remove("is-open")
      $pendingMessagesTrayToggle.setAttribute("aria-expanded", "false")
      $pendingMessagesTrayCount.textContent = ""
      services.syncContainerChildren($pendingMessagesTrayList, [])
      applyPendingMessageDragState()
      return
    }

    const items = orderedPendingUserItems()
    const count = items.length
    const validPendingIds = new Set(pendingUserItemIds(items))

    if (pendingMessageDragId && !validPendingIds.has(pendingMessageDragId)) {
      clearPendingMessageDragState({ restoreInitialOrder: false, apply: false })
    }

    if (count > 0 && lastPendingUserItemCount === 0) {
      state.pendingMessagesTrayOpen = false
    }
    lastPendingUserItemCount = count

    if (!count) {
      if (pendingMessageDragId) {
        clearPendingMessageDragState({
          restoreInitialOrder: false,
          apply: false,
        })
      }
      $pendingMessagesTray.classList.add("hidden")
      $pendingMessagesTray.classList.remove("is-open")
      $pendingMessagesTrayToggle.setAttribute("aria-expanded", "false")
      $pendingMessagesTrayCount.textContent = ""
      services.syncContainerChildren($pendingMessagesTrayList, [])
      applyPendingMessageDragState()
      return
    }

    const previousPositions = $pendingMessagesTrayList.classList.contains(
      "hidden"
    )
      ? new Map()
      : capturePendingMessageCardPositions()

    $pendingMessagesTray.classList.remove("hidden")
    $pendingMessagesTray.classList.toggle(
      "is-open",
      state.pendingMessagesTrayOpen
    )
    $pendingMessagesTrayToggle.setAttribute(
      "aria-expanded",
      state.pendingMessagesTrayOpen ? "true" : "false"
    )
    $pendingMessagesTrayCount.textContent = pendingMessageCountLabel(count)

    const elements = pendingMessageSections(items).map((section) =>
      renderPendingMessageSection(section, options)
    )

    services.syncContainerChildren($pendingMessagesTrayList, elements)
    $pendingMessagesTrayList.classList.toggle(
      "hidden",
      !state.pendingMessagesTrayOpen
    )
    animatePendingMessageCardPositions(previousPositions)
    applyPendingMessageDragState()
  }

  function renderMessageItem(item, options = {}) {
    if (!item || !$messages) return
    if (services.isPendingUserItem(item)) {
      renderPendingMessagesTray(options)
      return
    }

    const previousScrollTop = $messages.scrollTop
    const shouldFollow = state.followMessages
    const previousElement = item._element || null
    const nextElement = syncMessageElement(item, options)

    if (!nextElement) {
      if (previousElement?.parentNode === $messages) {
        previousElement.remove()
        restoreMessagesScroll(previousScrollTop, shouldFollow)
        return
      }
      renderMessages(options)
      return
    }

    if (
      previousElement &&
      previousElement !== nextElement &&
      previousElement.parentNode === $messages
    ) {
      previousElement.replaceWith(nextElement)
      restoreMessagesScroll(previousScrollTop, shouldFollow)
      return
    }

    if (nextElement.parentNode !== $messages) {
      renderMessages(options)
      return
    }

    restoreMessagesScroll(previousScrollTop, shouldFollow)
  }

  function syncMessageElement(item, options = {}) {
    return item.kind === "user"
      ? syncUserMessageElement(item, options)
      : syncAssistantMessageElement(item, options)
  }

  function syncUserMessageElement(item, options = {}) {
    if (options.force || !item._element) {
      item._element = renderUserMessage(item)
    }
    syncUserMessageCardState(item)
    return item._element
  }

  function syncUserMessageCardState(item) {
    const card = item?._element
    if (!card) return

    const pendingId = typeof item?.pendingId === "string" ? item.pendingId : ""
    const isPending = Boolean(services.isPendingUserItem(item) && pendingId)
    const isDraggable = isPending && !pendingMessageReordering
    const dragHandle = card.querySelector(".pending-message-drag-handle")

    if (pendingId) {
      card.dataset.pendingId = pendingId
    } else {
      delete card.dataset.pendingId
    }

    if (typeof item?.streamingBehavior === "string" && item.streamingBehavior) {
      card.dataset.pendingType = item.streamingBehavior
    } else {
      delete card.dataset.pendingType
    }

    card.classList.toggle("pending-message-card", isPending)
    card.classList.toggle("is-draggable", isDraggable)
    card.classList.toggle(
      "is-reorder-disabled",
      isPending && pendingMessageReordering
    )
    card.classList.toggle(
      "is-drag-source",
      isPending && pendingId === pendingMessageDragId
    )

    if (dragHandle) {
      dragHandle.classList.toggle("hidden", !isPending)
      dragHandle.classList.toggle("is-disabled", !isDraggable)
      dragHandle.title = isDraggable
        ? "Drag to reorder pending prompt"
        : "Pending prompt"
    }
  }

  function syncAssistantMessageElement(item, options = {}) {
    const { force = false } = options
    const card = item._element || document.createElement("article")
    card.className = "message-card assistant"
    item._element = card

    const elements = []
    for (const block of item.blocks) {
      const element = syncAssistantBlockElement(item, block, { force })
      if (element) {
        elements.push(element)
      }
    }

    services.syncContainerChildren(card, elements)

    if (!card.childElementCount) {
      card.hidden = false
      card.setAttribute("aria-hidden", "false")
      return null
    }

    card.hidden = false
    card.setAttribute("aria-hidden", "false")
    return card
  }

  function syncAssistantBlockElement(item, block, options = {}) {
    if (!block) return null

    if (block.type === "text") {
      return syncTextBlockElement(block, {
        ...options,
        streaming: item.streaming,
      })
    }

    if (block.type === "thinking") {
      return syncThinkingBlockElement(block, {
        ...options,
        streaming: item.streaming,
      })
    }

    if (block.type === "tool") {
      if (state.hideToolBlocks) return null
      return syncToolBlockElement(block, options)
    }

    if (block.type === "compaction") {
      return syncCompactionBlockElement(block, options)
    }

    return null
  }

  function syncTextBlockElement(block, options = {}) {
    const { streaming = false, force = false } = options
    const text = block.visibleText ?? block.text ?? ""
    const renderKey = `text:${streaming ? "streaming" : "final"}:${block.isError ? "error" : "ok"}`

    if (
      !block._element ||
      force ||
      block._renderKey !== renderKey ||
      (!streaming && block._renderText !== text) ||
      (streaming && !block._textNode)
    ) {
      block._element = renderTextBlock(block, { streaming })
      block._renderKey = renderKey
      block._renderText = text
      block._contentElement = streaming
        ? block._element.firstElementChild
        : null
      block._textNode = block._contentElement?._streamingTextNode || null
      return block._element
    }

    if (streaming && block._textNode && block._renderText !== text) {
      if (text.startsWith(block._renderText || "")) {
        block._textNode.data += text.slice((block._renderText || "").length)
      } else {
        block._textNode.data = text
      }
      block._renderText = text
    }

    return block._element
  }

  function syncThinkingBlockElement(block, options = {}) {
    const { streaming = false, force = false } = options

    if (state.hideThinkingBlock) {
      return null
    }

    const text = block.text || ""
    if (!String(text).trim()) return null
    const renderKey = `thinking:${streaming ? "streaming" : "final"}`

    if (
      !block._element ||
      force ||
      block._renderKey !== renderKey ||
      (!streaming && block._renderText !== text) ||
      (streaming && !block._textNode)
    ) {
      block._element = renderThinkingBlock(block, { streaming })
      block._renderKey = renderKey
      block._renderText = text
      block._contentElement = streaming
        ? block._element?.firstElementChild || null
        : null
      block._textNode = block._contentElement?._streamingTextNode || null
      return block._element
    }

    if (streaming && block._textNode && block._renderText !== text) {
      if (text.startsWith(block._renderText || "")) {
        block._textNode.data += text.slice((block._renderText || "").length)
      } else {
        block._textNode.data = text
      }
      block._renderText = text
    }

    return block._element
  }

  function toolRenderSignature(block) {
    try {
      return JSON.stringify({
        name: block.name,
        args: block.args ?? null,
        output: block.output || "",
        details: block.details ?? null,
        isError: Boolean(block.isError),
        running: Boolean(block.running),
      })
    } catch {
      return `${block.name}:${block.output || ""}:${Boolean(block.isError)}:${Boolean(block.running)}`
    }
  }

  function syncToolBlockElement(block, options = {}) {
    const renderKey = toolRenderSignature(block)
    if (!block._element || options.force || block._renderKey !== renderKey) {
      block._element = renderToolBlock(block)
      block._renderKey = renderKey
    }
    return block._element
  }

  function compactionRenderSignature(block) {
    return `${block.summary || ""}:${Number(block.tokensBefore) || 0}`
  }

  function syncCompactionBlockElement(block, options = {}) {
    const renderKey = compactionRenderSignature(block)
    if (!block._element || options.force || block._renderKey !== renderKey) {
      block._element = renderCompactionBlock(block)
      block._renderKey = renderKey
    }
    return block._element
  }

  function userMessageLabel(item) {
    if (item?.streamingBehavior === "steer") return "Steer"
    if (item?.queued || item?.streamingBehavior === "followUp") return "Queue"
    return ""
  }

  function createPendingMessageActionButton(label, className, onClick) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `pending-message-action ${className}`
    button.textContent = label
    button.addEventListener("click", async (event) => {
      event.preventDefault()
      event.stopPropagation()
      button.disabled = true
      try {
        await onClick()
      } catch (error) {
        services.showToast(
          error instanceof Error
            ? error.message
            : `Failed to ${label.toLowerCase()} pending prompt.`,
          "error"
        )
      } finally {
        button.disabled = false
      }
    })
    return button
  }

  async function removePendingMessageById(pendingId) {
    if (!pendingId) {
      throw new Error("Pending prompt not found.")
    }
    await services.post("/api/pending-message/remove", { pendingId })
  }

  async function deletePendingMessage(item) {
    await removePendingMessageById(item?.pendingId)
  }

  async function editPendingMessage(item) {
    const nextText = typeof item?.text === "string" ? item.text : ""
    const nextImages = Array.isArray(item?.images)
      ? item.images
          .map((image) => services.createComposerImage(image))
          .filter(Boolean)
      : []

    if (services.composerHasSubmittableContent()) {
      const confirmed = await services.openConfirmDialog({
        title: "Replace draft",
        message: "Replace the current draft with this pending prompt?",
        confirmLabel: "Replace",
      })
      if (!confirmed) return
    }

    await removePendingMessageById(item?.pendingId)
    services.setComposerText(nextText)
    state.composerImages = nextImages
    services.rememberComposerDraft(state)
    services.renderComposerImages()
    services.renderSlashCommandMenu()
    services.renderSendButton()
    services.focusPromptField()
  }

  function renderUserMessage(item) {
    const card = document.createElement("article")
    card.className = "message-card user"

    const labelText = userMessageLabel(item)
    const showPendingActions = Boolean(
      services.isPendingUserItem(item) && item?.pendingId
    )
    const showLabelPill = Boolean(labelText) && !showPendingActions
    if (showLabelPill || showPendingActions) {
      const meta = document.createElement("div")
      meta.className = "user-message-meta"

      if (showLabelPill) {
        const pill = document.createElement("span")
        pill.className = `user-message-pill ${labelText.toLowerCase()}`
        pill.textContent = labelText
        meta.appendChild(pill)
      }

      if (showPendingActions) {
        const dragHandle = document.createElement("span")
        dragHandle.className = "pending-message-drag-handle"
        dragHandle.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-grip"><circle cx="12" cy="5" r="1"></circle><circle cx="19" cy="5" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="19" cy="19" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg>'
        dragHandle.setAttribute("aria-hidden", "true")
        dragHandle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || pendingMessageReordering) return
          event.preventDefault()
          event.stopPropagation()
          beginPendingMessageDrag(item, card, event)
        })
        meta.appendChild(dragHandle)

        const actions = document.createElement("div")
        actions.className = "pending-message-actions"
        actions.append(
          createPendingMessageActionButton("Edit", "edit", () =>
            editPendingMessage(item)
          ),
          createPendingMessageActionButton("Delete", "delete", () =>
            deletePendingMessage(item)
          )
        )
        meta.appendChild(actions)
      }

      card.appendChild(meta)
    }

    const text = typeof item.text === "string" ? item.text : ""
    if (text) {
      const body = document.createElement("div")
      body.className = "user-message-body"
      body.textContent = text
      card.append(body)
    }

    if (Array.isArray(item.images) && item.images.length > 0) {
      const previews = document.createElement("div")
      previews.className = "user-message-images"

      for (const image of item.images) {
        const preview = document.createElement("img")
        preview.className = "user-message-image"
        preview.src = image.previewUrl
        preview.alt = "User attached image"
        preview.loading = "lazy"
        previews.appendChild(preview)
      }

      card.appendChild(previews)
    }

    return card
  }

  function createStreamingTextContent(
    text,
    className = "block-content streaming-text-content"
  ) {
    const content = document.createElement("div")
    content.className = className
    const textNode = document.createTextNode(text || "")
    content.appendChild(textNode)
    content._streamingTextNode = textNode
    return content
  }

  function renderTextBlock(block, options = {}) {
    const { streaming = false } = options
    const wrap = document.createElement("section")
    wrap.className = `block text${block.isError ? " error" : ""}`

    if (streaming) {
      const content = createStreamingTextContent(
        block.visibleText ?? block.text,
        `block-content streaming-text-content${block.isError ? " error" : ""}`
      )
      wrap.appendChild(content)
      return wrap
    }

    const content = renderMarkdownContent(
      block.visibleText ?? block.text,
      `block-content markdown-block${block.isError ? " error" : ""}`
    )
    wrap.appendChild(content)
    return wrap
  }

  function sanitizeThinkingSummaryText(value) {
    if (typeof value !== "string") return ""

    let text = value.replace(/\r\n?/g, "\n")

    text = text.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_match, altText) => altText || "image"
    )
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1")
    text = text.replace(/```([\s\S]*?)```/g, "$1")
    text = text.replace(/`([^`]+)`/g, "$1")
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1")
    text = text.replace(/__([^_]+)__/g, "$1")
    text = text.replace(/\*([^*\n]+)\*/g, "$1")
    text = text.replace(/_([^_\n]+)_/g, "$1")
    text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "")
    text = text.replace(/^\s*>\s?/gm, "")
    text = text.replace(/^\s*[-*+]\s+/gm, "")
    text = text.replace(/^\s*\d+\.\s+/gm, "")
    text = text.replace(
      /\/var\/folders\/[^\s)]*\/pi-clipboard-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp)\b/gi,
      "pasted image"
    )
    text = text.replace(/\s+/g, " ").trim()

    return text
  }

  function primaryThinkingSummaryText(value) {
    if (typeof value !== "string") return ""

    const normalized = value.replace(/\r\n?/g, "\n")
    const paragraphs = normalized
      .split(/\n\s*\n+/)
      .map((part) => sanitizeThinkingSummaryText(part))
      .filter(Boolean)

    if (paragraphs.length) {
      return paragraphs[0]
    }

    return sanitizeThinkingSummaryText(normalized)
  }

  function meaningfulHiddenThinkingLabel(value) {
    const label = sanitizeThinkingSummaryText(value || "")
    return label && label !== "Thinking..." && label !== "Thinking" ? label : ""
  }

  function truncateThinkingSummary(text) {
    if (typeof text !== "string") return ""
    const normalized = text.trim()
    if (!normalized) return ""
    return normalized.length > 140
      ? `${normalized.slice(0, 137).trimEnd()}…`
      : normalized
  }

  function thinkingSummaryText(block, options = {}) {
    const { allowUiLabel = true, allowPlaceholder = true } = options

    const blockLabel = meaningfulHiddenThinkingLabel(block?.summaryLabel)
    if (blockLabel) {
      return truncateThinkingSummary(blockLabel)
    }

    const hiddenLabel = allowUiLabel
      ? meaningfulHiddenThinkingLabel(state.uiState.hiddenThinkingLabel)
      : ""
    if (hiddenLabel) {
      return truncateThinkingSummary(hiddenLabel)
    }

    const text = primaryThinkingSummaryText(block?.text)
    if (!text) return allowPlaceholder ? "Thinking…" : ""
    return truncateThinkingSummary(text)
  }

  function renderThinkingBlock(block, options = {}) {
    const { streaming = false } = options

    if (!String(block?.text || "").trim()) return null

    const wrap = document.createElement("section")
    wrap.className = "block thinking"

    if (streaming) {
      const content = createStreamingTextContent(
        block.text,
        "block-content thinking-content streaming-text-content"
      )
      wrap.appendChild(content)
      return wrap
    }

    const content = renderMarkdownContent(
      block.text,
      "block-content thinking-content markdown-block"
    )
    wrap.appendChild(content)
    return wrap
  }

  function compactionTriggerText(block) {
    const tokensBefore = Number(block?.tokensBefore) || 0
    if (tokensBefore > 0) {
      const formattedTokens =
        typeof services.formatNumber === "function"
          ? services.formatNumber(tokensBefore)
          : new Intl.NumberFormat("en-US").format(tokensBefore)
      return `Compaction: Compacted from ${formattedTokens} tokens`
    }
    return "Compaction"
  }

  function renderCompactionBlock(block) {
    const wrap = document.createElement("section")
    wrap.className = "block compaction"

    const accordion = document.createElement("details")
    accordion.className = "compaction-accordion"

    const trigger = document.createElement("summary")
    trigger.className = "compaction-trigger"

    const chevron = document.createElement("span")
    chevron.className = "compaction-chevron"
    chevron.setAttribute("aria-hidden", "true")
    chevron.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>'

    const label = document.createElement("span")
    label.className = "compaction-trigger-label"
    label.textContent = compactionTriggerText(block)

    trigger.append(chevron, label)
    accordion.appendChild(trigger)

    const content = document.createElement("div")
    content.className = "compaction-content"

    const summary =
      typeof block?.summary === "string" ? block.summary.trim() : ""
    if (summary) {
      content.appendChild(
        renderMarkdownContent(
          summary,
          "block-content markdown-block compaction-markdown"
        )
      )
    } else {
      const empty = document.createElement("div")
      empty.className = "compaction-empty"
      empty.textContent = "No compaction summary available."
      content.appendChild(empty)
    }

    accordion.appendChild(content)
    wrap.appendChild(accordion)
    return wrap
  }

  function renderToolBlock(block) {
    const wrap = document.createElement("section")
    wrap.className = `block tool ${block.running ? "running" : block.isError ? "error" : "success"}`

    const header = document.createElement("div")
    header.className = "tool-header"

    const titleWrap = document.createElement("div")
    titleWrap.className = "tool-header-main"

    const title = document.createElement("div")
    title.className = "tool-header-title"
    title.textContent =
      block.name === "read" ? "read" : toolDisplayName(block.name)

    const subtitleText = toolSummary(block)

    titleWrap.appendChild(title)

    if (subtitleText) {
      const subtitle = document.createElement("div")
      subtitle.className = "tool-header-subtitle"
      subtitle.textContent = subtitleText
      titleWrap.appendChild(subtitle)
    }

    header.appendChild(titleWrap)
    wrap.appendChild(header)

    const content = document.createElement("div")
    content.className = "block-content tool-content"

    const diffData = toolDiffPreview(block)
    if (diffData.length) {
      content.appendChild(renderToolDiff(diffData))
    }

    const hideSuccessfulOutput =
      !block.isError &&
      !block.running &&
      (block.name === "edit" ||
        block.name === "bash" ||
        block.name === "grep" ||
        block.name === "find" ||
        block.name === "ls")

    const lines = []
    if (block.output && block.name !== "read" && !hideSuccessfulOutput) {
      lines.push(block.output)
    }

    if (lines.length) {
      content.appendChild(prettyPre(lines.join("\n")))
    }

    if (content.childElementCount) {
      wrap.appendChild(content)
    }

    return wrap
  }

  function prettyPre(text, className = "tool-pre") {
    const pre = document.createElement("pre")
    pre.className = className
    pre.textContent = text
    return pre
  }

  function toolDisplayName(name) {
    switch (name) {
      case "bash":
        return "Shell"
      case "read":
        return "Read"
      case "write":
        return "Write"
      case "edit":
        return "Edit"
      case "grep":
        return "Search"
      case "find":
        return "Find"
      case "ls":
        return "List"
      default:
        return name
    }
  }

  function toolSummary(block) {
    const command =
      block.name === "read"
        ? toolReadLocation(block)
        : toolCommandPreview(block)
    if (command) return command
    if (block.running) return "Running"
    if (block.isError) return "Failed"
    return "Done"
  }

  function toolCommandPreview(block) {
    const args = normalizeToolArgs(block.args)
    if (!args) {
      return typeof block.args === "string" ? block.args : ""
    }
    if (typeof args.description === "string" && args.description.trim()) {
      return args.description.trim()
    }
    if (typeof args.command === "string" && args.command.trim()) {
      return args.command.trim()
    }
    if (typeof args.path === "string" && args.path.trim()) {
      return services.tildePath(args.path.trim())
    }
    if (typeof args.filePath === "string" && args.filePath.trim()) {
      return services.tildePath(args.filePath.trim())
    }
    return ""
  }

  function toolReadLocation(block) {
    const args = normalizeToolArgs(block.args)
    if (!args) return ""

    const filePath =
      typeof args.path === "string"
        ? args.path
        : typeof args.filePath === "string"
          ? args.filePath
          : ""
    const pathText = filePath ? services.tildePath(filePath) : ""
    const offset = typeof args.offset === "number" ? args.offset : undefined
    const limit = typeof args.limit === "number" ? args.limit : undefined

    if (offset != null && limit != null && limit > 0) {
      return `${pathText}:${offset}-${offset + limit - 1}`
    }
    if (offset != null) {
      return `${pathText}:${offset}`
    }
    if (limit != null) {
      return `${pathText} limit=${limit}`.trim()
    }
    return pathText
  }

  function toolDiffPreview(block) {
    if (block.name !== "edit" || block.isError) return []
    const diff =
      typeof block?.details?.diff === "string" ? block.details.diff : ""
    if (!diff) return []
    return diff.split("\n").map(parseToolDiffLine).filter(Boolean)
  }

  function parseToolDiffLine(line) {
    if (typeof line !== "string" || !line.length) return null
    const match = line.match(/^([+\- ])(\s*\d*)\s(.*)$/)
    if (!match) {
      return { type: "context", text: line }
    }
    return {
      type: match[1] === "+" ? "add" : match[1] === "-" ? "remove" : "context",
      lineNumber: match[2],
      text: match[3],
    }
  }

  function renderToolDiff(lines) {
    const pre = document.createElement("pre")
    pre.className = "tool-pre tool-diff"
    for (const line of lines) {
      const row = document.createElement("div")
      row.className = `tool-diff-line ${line.type}`
      row.textContent =
        typeof line.lineNumber === "string"
          ? `${line.lineNumber} ${line.text}`
          : line.text
      pre.appendChild(row)
    }
    return pre
  }

  function normalizeToolArgs(args) {
    if (!args) return undefined
    if (typeof args === "object") return args
    if (typeof args !== "string") return undefined
    try {
      return JSON.parse(args)
    } catch {
      return undefined
    }
  }

  function togglePendingMessagesTray() {
    if (!$messages) return
    const previousScrollTop = $messages.scrollTop
    const shouldFollow = state.followMessages
    state.pendingMessagesTrayOpen = !state.pendingMessagesTrayOpen
    renderPendingMessagesTray()
    restoreMessagesScroll(previousScrollTop, shouldFollow)
  }

  function handleMessagesScroll() {
    if (!$messages) return
    const currentScrollTop = $messages.scrollTop
    const movedUp = currentScrollTop < lastMessagesScrollTop
    if (movedUp) {
      state.followMessages = false
    } else if (isMessagesNearBottom()) {
      state.followMessages = true
    }
    lastMessagesScrollTop = currentScrollTop
    renderScrollToBottomButton()
  }

  function handleMessagesWheel(event) {
    if (event.deltaY < 0) {
      state.followMessages = false
    }
  }

  function scrollToBottom() {
    if (!$messages) return
    $messages.scrollTop = $messages.scrollHeight
    state.followMessages = true
    lastMessagesScrollTop = $messages.scrollTop
    renderScrollToBottomButton()
  }

  function scrollToLastMessage() {
    if (!$messages) return
    const target = previousMessageJumpTarget()
    if (!(target?.element instanceof HTMLElement)) return
    $messages.scrollTop = target.scrollTop
    state.followMessages = false
    lastMessagesScrollTop = $messages.scrollTop
    renderScrollToBottomButton()
  }

  return {
    flushVisibleText,
    handleMessagesScroll,
    handleMessagesWheel,
    isMessagesNearBottom,
    meaningfulHiddenThinkingLabel,
    renderComposerFooterShadow,
    renderMessageItem,
    renderMessages,
    renderPendingMessagesTray,
    renderScrollToBottomButton,
    restoreMessagesScroll,
    scheduleTextPacer,
    scrollToBottom,
    scrollToLastMessage,
    stopTextPacer,
    thinkingSummaryText,
    togglePendingMessagesTray,
    truncateThinkingSummary,
  }
}
