/**
 * The CodeMirror 6 view for project files, in read mode and in edit mode.
 * One engine for both modes keeps the syntax colors the same. The parent
 * loads this module lazily, so CodeMirror is not in the main bundle. The
 * editor keeps its own document: the parent gets each change through
 * `onChange`, and gives a new `docVersion` to replace the document (for
 * example after a reload, or when the file changes on disk).
 */
import * as React from "react"
import { indentWithTab } from "@codemirror/commands"
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { Compartment, EditorState, Transaction } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"

const picoHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--code-comment)",
    fontStyle: "italic",
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
    ],
    color: "var(--code-keyword)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
    color: "var(--code-string)",
  },
  {
    tag: [
      tags.number,
      tags.bool,
      tags.null,
      tags.atom,
      tags.constant(tags.name),
    ],
    color: "var(--code-number)",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.typeName,
      tags.className,
      tags.namespace,
      tags.heading,
      tags.link,
    ],
    color: "var(--code-title)",
  },
  {
    tag: [
      tags.meta,
      tags.punctuation,
      tags.bracket,
      tags.operator,
      tags.processingInstruction,
    ],
    color: "var(--code-meta)",
  },
  {
    tag: [
      tags.variableName,
      tags.propertyName,
      tags.attributeName,
      tags.labelName,
      tags.tagName,
    ],
    color: "var(--code-variable)",
  },
  {
    tag: [tags.self, tags.special(tags.variableName)],
    color: "var(--code-symbol)",
  },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, color: "var(--danger)" },
])

const picoEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--code-fg)",
    backgroundColor: "var(--background)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.25rem",
  },
  ".cm-content": {
    padding: "1rem 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0 1rem 0 0.5rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--code-selection)" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight:
      "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--muted) 50%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--muted) 50%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    borderColor: "var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--primary) 20%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--warning) 30%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
})

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) || path
}

const readOnlyExtensions = (readOnly: boolean) => [
  EditorState.readOnly.of(readOnly),
  // In read mode, show no active line until the user clicks in the file.
  readOnly
    ? EditorView.theme({
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "transparent",
        },
      })
    : [],
]

export type ProjectFileEditorProps = {
  path: string
  /** The document. The editor reads it at the start and on a new `docVersion`. */
  doc: string
  docVersion: string
  readOnly: boolean
  onChange: (doc: string) => void
  onSave: () => void
}

export default function ProjectFileEditor({
  path,
  doc,
  docVersion,
  readOnly,
  onChange,
  onSave,
}: ProjectFileEditorProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const languageCompartment = React.useRef(new Compartment()).current
  const readOnlyCompartment = React.useRef(new Compartment()).current
  const readOnlyRef = React.useRef(readOnly)
  const callbacks = React.useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  // The editor reads the document only on mount and on a new revision.
  const docRef = React.useRef(doc)
  docRef.current = doc

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: docRef.current,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave()
                return true
              },
            },
          ]),
          languageCompartment.of([]),
          readOnlyCompartment.of(readOnlyExtensions(readOnlyRef.current)),
          syntaxHighlighting(picoHighlightStyle),
          picoEditorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    if (!readOnlyRef.current) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The editor is made one time. Later changes go through transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the language of the file, then turn it on.
  React.useEffect(() => {
    let cancelled = false
    const description = LanguageDescription.matchFilename(
      languages,
      fileNameFromPath(path)
    )
    if (!description) {
      viewRef.current?.dispatch({
        effects: languageCompartment.reconfigure([]),
      })
      return
    }
    void description.load().then((support) => {
      if (cancelled) return
      viewRef.current?.dispatch({
        effects: languageCompartment.reconfigure(support),
      })
    })
    return () => {
      cancelled = true
    }
  }, [languageCompartment, path])

  // Switch between read mode and edit mode. Edit mode takes the focus.
  React.useEffect(() => {
    if (readOnlyRef.current === readOnly) return
    readOnlyRef.current = readOnly
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)),
    })
    if (!readOnly) view.focus()
  }, [readOnly, readOnlyCompartment])

  // Replace the document when the parent gives a new version. The change is
  // not in the undo history, so undo cannot go back to an older file.
  const appliedVersion = React.useRef(docVersion)
  React.useEffect(() => {
    if (appliedVersion.current === docVersion) return
    appliedVersion.current = docVersion
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === docRef.current) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: docRef.current },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [docVersion])

  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
}
