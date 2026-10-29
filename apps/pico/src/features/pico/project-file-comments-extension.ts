/**
 * CodeMirror support for comments on lines of a project file:
 * - a "+" in a gutter beside the line under the pointer starts a comment on
 *   that line;
 * - a "Comment" button beside a selection starts a comment on its lines;
 * - commented lines get a background, and block widgets under them hold the
 *   saved notes and the open form.
 * React owns the content of the widgets: it gives each widget a container
 * element and draws into it with a portal. React gives the layout with
 * `setFileCommentLayout`.
 */
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state"
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  showTooltip,
  WidgetType,
  type Tooltip,
} from "@codemirror/view"

export type FileCommentRange = { startLine: number; endLine: number }

export type FileCommentLayout = {
  /** False hides the "+" and disables the selection button. */
  canComment: boolean
  /** Why comments are off, shown on the disabled selection button. */
  disabledReason?: string
  notes: Array<FileCommentRange & { container: HTMLElement }>
  pending: (FileCommentRange & { container: HTMLElement }) | null
}

export type FileCommentHandlers = {
  start: (range: FileCommentRange) => void
}

const EMPTY_LAYOUT: FileCommentLayout = {
  canComment: false,
  notes: [],
  pending: null,
}

export const setFileCommentLayout = StateEffect.define<FileCommentLayout>()

const layoutField = StateField.define<FileCommentLayout>({
  create: () => EMPTY_LAYOUT,
  update(layout, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setFileCommentLayout)) return effect.value
    return layout
  },
})

/** A block widget that shows an element that React draws into. */
class ContainerWidget extends WidgetType {
  constructor(readonly container: HTMLElement) {
    super()
  }
  eq(other: ContainerWidget) {
    return other.container === this.container
  }
  toDOM() {
    return this.container
  }
  // The form and the notes handle their own pointer and key events.
  ignoreEvent() {
    return true
  }
}

const commentedLine = Decoration.line({ class: "cm-pico-commented-line" })

function lineInDoc(state: EditorState, lineNumber: number) {
  return Math.min(Math.max(1, lineNumber), state.doc.lines)
}

const commentDecorations = EditorView.decorations.compute(
  [layoutField, "doc"],
  (state) => {
    const layout = state.field(layoutField)
    const ranges = []
    const blocks = [
      ...layout.notes,
      ...(layout.pending ? [layout.pending] : []),
    ]
    for (const block of blocks) {
      const start = lineInDoc(state, block.startLine)
      const end = lineInDoc(state, block.endLine)
      for (let line = start; line <= end; line += 1)
        ranges.push(commentedLine.range(state.doc.line(line).from))
      ranges.push(
        Decoration.widget({
          widget: new ContainerWidget(block.container),
          block: true,
          side: 1,
        }).range(state.doc.line(end).to)
      )
    }
    return Decoration.set(ranges, true)
  }
)

/** The lines of a selection. A selection that ends at a line start leaves that line out. */
export function selectionLines(
  state: EditorState,
  range: SelectionRange
): FileCommentRange {
  const startLine = state.doc.lineAt(range.from).number
  const end = state.doc.lineAt(range.to)
  const endLine =
    range.to > range.from && range.to === end.from && end.number > startLine
      ? end.number - 1
      : end.number
  return { startLine, endLine }
}

// The line under the pointer, for the "+" in the gutter.
const setHoverLine = StateEffect.define<number | null>()
const hoverLineField = StateField.define<number | null>({
  create: () => null,
  update(line, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setHoverLine)) return effect.value
    return line
  },
})

const hoverTracking = EditorView.domEventHandlers({
  mousemove(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    const line = pos === null ? null : view.state.doc.lineAt(pos).number
    if (line !== view.state.field(hoverLineField))
      view.dispatch({ effects: setHoverLine.of(line) })
    return false
  },
  mouseleave(_event, view) {
    if (view.state.field(hoverLineField) !== null)
      view.dispatch({ effects: setHoverLine.of(null) })
    return false
  },
})

class PlusMarker extends GutterMarker {
  toDOM() {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "cm-pico-comment-plus"
    button.textContent = "+"
    button.title = "Comment on this line"
    button.setAttribute("aria-label", "Comment on this line")
    return button
  }
}
const plusMarker = new PlusMarker()

class SpacerMarker extends GutterMarker {
  toDOM() {
    const spacer = document.createElement("span")
    spacer.className = "cm-pico-comment-plus"
    return spacer
  }
}

function commentGutter(handlers: { current: FileCommentHandlers }) {
  return gutter({
    class: "cm-pico-comment-gutter",
    lineMarker(view, line) {
      const layout = view.state.field(layoutField)
      const hovered = view.state.field(hoverLineField)
      if (!layout.canComment || hovered === null) return null
      return view.state.doc.lineAt(line.from).number === hovered
        ? plusMarker
        : null
    },
    lineMarkerChange: (update) =>
      update.startState.field(hoverLineField) !==
        update.state.field(hoverLineField) ||
      update.startState.field(layoutField).canComment !==
        update.state.field(layoutField).canComment,
    initialSpacer: () => new SpacerMarker(),
    domEventHandlers: {
      mousedown(view, line, event) {
        if (!view.state.field(layoutField).canComment) return false
        const target = event.target as HTMLElement | null
        if (!target?.closest(".cm-pico-comment-plus")) return false
        event.preventDefault()
        const lineNumber = view.state.doc.lineAt(line.from).number
        handlers.current.start({ startLine: lineNumber, endLine: lineNumber })
        return true
      },
    },
  })
}

function selectionTooltip(
  state: EditorState,
  handlers: { current: FileCommentHandlers }
): ReadonlyArray<Tooltip> {
  const layout = state.field(layoutField)
  const selection = state.selection.main
  if (selection.empty || layout.pending) return []
  return [
    {
      pos: selection.head,
      above: selection.head <= selection.anchor,
      strictSide: false,
      arrow: false,
      create: (view) => {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "cm-pico-comment-selection"
        button.textContent = layout.canComment ? "Comment" : "Save to comment"
        if (!layout.canComment) {
          button.disabled = true
          button.title = layout.disabledReason ?? ""
        }
        // Keep the selection when the button takes the pointer.
        button.addEventListener("mousedown", (event) => event.preventDefault())
        button.addEventListener("click", () => {
          handlers.current.start(
            selectionLines(view.state, view.state.selection.main)
          )
        })
        return { dom: button }
      },
    },
  ]
}

function selectionTooltipField(handlers: { current: FileCommentHandlers }) {
  return StateField.define<ReadonlyArray<Tooltip>>({
    create: (state) => selectionTooltip(state, handlers),
    update(tooltips, transaction) {
      const layoutChanged = transaction.effects.some((effect) =>
        effect.is(setFileCommentLayout)
      )
      if (!transaction.docChanged && !transaction.selection && !layoutChanged)
        return tooltips
      return selectionTooltip(transaction.state, handlers)
    },
    provide: (field) =>
      showTooltip.computeN([field], (state) => state.field(field)),
  })
}

const commentTheme = EditorView.theme({
  ".cm-pico-commented-line": {
    backgroundColor: "color-mix(in oklab, var(--warning) 12%, transparent)",
  },
  ".cm-pico-comment-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  },
  ".cm-pico-comment-plus": {
    display: "inline-flex",
    width: "1rem",
    height: "1rem",
    alignItems: "center",
    justifyContent: "center",
    border: "0",
    borderRadius: "0.25rem",
    padding: "0",
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
    font: "600 12px/1 var(--font-sans, sans-serif)",
    cursor: "pointer",
  },
  "span.cm-pico-comment-plus": { visibility: "hidden" },
  ".cm-tooltip.cm-tooltip:has(.cm-pico-comment-selection)": {
    border: "0",
    backgroundColor: "transparent",
  },
  ".cm-pico-comment-selection": {
    border: "1px solid var(--border)",
    borderRadius: "0.375rem",
    padding: "0.125rem 0.5rem",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    font: "500 12px/1.4 var(--font-sans, sans-serif)",
    boxShadow: "0 1px 3px rgb(0 0 0 / 0.15)",
    cursor: "pointer",
  },
  ".cm-pico-comment-selection:disabled": {
    cursor: "not-allowed",
    opacity: "0.6",
  },
})

export function fileCommentsExtension(handlers: {
  current: FileCommentHandlers
}): Extension {
  return [
    layoutField,
    hoverLineField,
    hoverTracking,
    commentDecorations,
    commentGutter(handlers),
    selectionTooltipField(handlers),
    commentTheme,
  ]
}
