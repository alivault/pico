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
  LanguageSupport,
  LRLanguage,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language"
import { cssLanguage } from "@codemirror/lang-css"
import { jsonLanguage } from "@codemirror/lang-json"
import { yamlLanguage } from "@codemirror/lang-yaml"
import { languages } from "@codemirror/language-data"
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  Transaction,
  type Extension,
} from "@codemirror/state"
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { styleTags, tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { createPortal } from "react-dom"

import {
  fileLineCommentSnippet,
  formatComposerFileLineCommentReference,
} from "@/features/pico/composer-utils"
import { LineCommentForm } from "@/features/pico/line-comment-form"
import {
  fileCommentsExtension,
  setFileCommentLayout,
  type FileCommentHandlers,
  type FileCommentRange,
} from "@/features/pico/project-file-comments-extension"

// Colors follow Shiki's CSS-variables theme (createCssVariablesTheme in
// @shikijs/core) with Pico's values from PICO_SHIKI_VARIABLE_DEFAULTS, so
// files look like chat code blocks and diffs. Lezer tags are not TextMate
// scopes, so some tokens still differ (for example primitive types).
const code = {
  comment: "var(--code-comment)",
  constant: "var(--code-number)",
  keyword: "var(--code-keyword)",
  function: "var(--code-title)",
  string: "var(--code-string)",
  punctuation: "var(--code-meta)",
  link: "var(--code-title)",
}

// Do not style propertyName or content here: the language styles below set
// them for JSON, YAML, and CSS, and two styles for one token would conflict.
const picoHighlightStyle = HighlightStyle.define([
  // comment
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: code.comment,
  },
  // keyword, storage.type, storage.modifier, keyword.operator,
  // punctuation.definition.template-expression
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
      tags.operator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.updateOperator,
      tags.definitionOperator,
      tags.typeOperator,
      tags.controlOperator,
      tags.punctuation,
      tags.function(tags.punctuation),
      tags.special(tags.brace),
      tags.unit,
    ],
    color: code.keyword,
  },
  // string, string.regexp, string.template, entity.name.tag, markup.inline
  {
    tag: [
      tags.string,
      tags.special(tags.string),
      tags.regexp,
      tags.escape,
      tags.character,
      tags.attributeValue,
      tags.tagName,
      tags.standard(tags.tagName),
      tags.monospace,
    ],
    color: code.string,
  },
  // constant.numeric, constant.language, variable.language.this,
  // variable.other.constant (`const` names), support
  {
    tag: [
      tags.number,
      tags.integer,
      tags.float,
      tags.bool,
      tags.null,
      tags.atom,
      tags.self,
      tags.color,
      tags.constant(tags.name),
      tags.standard(tags.name),
      tags.definition(tags.variableName),
    ],
    color: code.constant,
  },
  // entity.name.function, meta.function-call, entity.name.type,
  // entity.other.attribute-name, meta.instance.constructor
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.function(tags.definition(tags.variableName)),
      tags.typeName,
      tags.definition(tags.typeName),
      tags.className,
      tags.definition(tags.className),
      // entity.other.attribute-name.pseudo-class (CSS :root)
      tags.constant(tags.className),
      tags.namespace,
      tags.attributeName,
      tags.macroName,
    ],
    color: code.function,
  },
  // The "." of a method call (meta.function-call)
  { tag: tags.function(tags.derefOperator), color: code.function },
  // punctuation.separator
  { tag: tags.separator, color: code.punctuation },
  // Brackets and "." (keyword.operator.accessor) keep the text color. Their
  // Lezer tags are children of punctuation and operator, so say it here.
  {
    tag: [
      tags.bracket,
      tags.paren,
      tags.brace,
      tags.squareBracket,
      tags.angleBracket,
      tags.derefOperator,
    ],
    color: "inherit",
  },
  // Markdown and diffs
  { tag: [tags.strong, tags.heading], fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: code.link, textDecoration: "underline" },
  { tag: tags.url, color: code.link },
  { tag: tags.inserted, color: "var(--success)" },
  { tag: tags.deleted, color: "var(--danger)" },
  { tag: tags.changed, color: "var(--warning)" },
])

// The JavaScript parser tags every declared name as a definition, and every
// object name as a plain variable. Shiki tells more cases apart, so add rules
// for them: parameters, catch variables, and imports are plain; objects
// before "." are variable.other.object; the "." of a method call is part of
// meta.function-call. The deepest matching rule wins.
const javaScriptStyleTags = styleTags({
  "ParamList/VariableDefinition CatchClause/VariableDefinition ImportGroup/VariableDefinition ImportDeclaration/VariableDefinition":
    tags.variableName,
  "ParamList/ObjectPattern/PatternProperty/VariableDefinition ParamList/ArrayPattern/VariableDefinition":
    tags.variableName,
  // constant.language.import-export-all
  "ImportDeclaration/Star": tags.atom,
  // super() is meta.function-call; the base class is entity.other.inherited-class
  "CallExpression/super": tags.function(tags.variableName),
  "ClassDeclaration/VariableName": tags.className,
  // keyword.operator.optional (name?: type)
  '"?"': tags.operator,
  "MemberExpression/VariableName MemberExpression/MemberExpression/PropertyName":
    tags.standard(tags.variableName),
  'CallExpression/MemberExpression/"."': tags.function(tags.derefOperator),
  // punctuation.terminator.statement keeps the text color.
  '";"': tags.bracket,
})

// YAML: ":" is punctuation.separator.key-value (keyword color), "-" keeps the
// text color, and "|" or ">" is keyword.control.flow.block-scalar.
const yamlStyleTags = styleTags({
  '":"': tags.definitionOperator,
  '"-"': tags.bracket,
  BlockLiteralHeader: tags.keyword,
})

// CSS: ";" keeps the text color, functions such as var() are support.function,
// pseudo-classes (with their ":") are entity.other.attribute-name, "*" is entity.name.tag, and
// media feature names and values keep the text color.
const cssStyleTags = styleTags({
  '";"': tags.bracket,
  Callee: tags.function(tags.variableName),
  // Not attributeName: it is a child of propertyName, which the CSS style colors.
  'PseudoOp PseudoClassSelector/":"': tags.constant(tags.className),
  "ArgList/VariableName": tags.standard(tags.variableName),
  UniversalSelector: tags.tagName,
  "FeatureName FeatureQuery/ValueName": tags.variableName,
})

// Shiki colors TypeScript primitive types (support.type.primitive) and
// ALL_CAPS names (variable.other.constant) as constants. Lezer gives them
// the same tags as other names, so mark them by their text.
const PRIMITIVE_TYPES = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
])
const ALL_CAPS_NAME = /^[A-Z][A-Z0-9_]*[A-Z0-9]$/
const constantMark = Decoration.mark({ class: "cm-pico-constant" })
// entity.name.function for `const f = () => …`, plain for `let` and `var`
// names (Lezer tags them like `const` names), storage.type for constructor.
const functionMark = Decoration.mark({ class: "cm-pico-function" })
const plainMark = Decoration.mark({ class: "cm-pico-plain" })
const keywordMark = Decoration.mark({ class: "cm-pico-keyword" })

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"]

function declarationMark(node: SyntaxNode) {
  if (node.parent?.name !== "VariableDeclaration") return undefined
  const value =
    node.nextSibling?.name === "Equals" ? node.nextSibling.nextSibling : null
  if (value?.name === "ArrowFunction" || value?.name === "FunctionExpression")
    return functionMark
  const keyword = node.parent.firstChild?.name
  return keyword === "let" || keyword === "var" ? plainMark : undefined
}

function shikiNameDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const isType = node.name === "TypeName"
        if (
          !isType &&
          node.name !== "VariableName" &&
          node.name !== "VariableDefinition" &&
          node.name !== "PropertyName" &&
          node.name !== "PropertyDefinition"
        )
          return
        const text = view.state.sliceDoc(node.from, node.to)
        if (isType ? PRIMITIVE_TYPES.has(text) : ALL_CAPS_NAME.test(text)) {
          builder.add(node.from, node.to, constantMark)
          return
        }
        const mark =
          node.name === "VariableDefinition"
            ? declarationMark(node.node)
            : node.name === "PropertyDefinition" && text === "constructor"
              ? keywordMark
              : undefined
        if (mark) builder.add(node.from, node.to, mark)
      },
    })
  }
  return builder.finish()
}

const shikiNamePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = shikiNameDecorations(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = shikiNameDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

const JAVASCRIPT_LANGUAGE_NAMES = new Set([
  "JavaScript",
  "TypeScript",
  "JSX",
  "TSX",
])

/** Add Pico's style rules to a language that CodeMirror loaded. */
function withPicoStyleTags(
  description: LanguageDescription,
  support: LanguageSupport
): Extension {
  if (!(support.language instanceof LRLanguage)) return support
  if (JAVASCRIPT_LANGUAGE_NAMES.has(description.name))
    return [
      new LanguageSupport(
        support.language.configure({ props: [javaScriptStyleTags] }),
        support.support
      ),
      shikiNamePlugin,
    ]
  const props =
    description.name === "YAML"
      ? yamlStyleTags
      : description.name === "CSS"
        ? cssStyleTags
        : undefined
  if (!props) return support
  return new LanguageSupport(
    support.language.configure({ props: [props] }),
    support.support
  )
}

// support.type.property-name.json
const jsonHighlightStyle = HighlightStyle.define(
  [{ tag: tags.propertyName, color: code.keyword }],
  { scope: jsonLanguage }
)

// entity.name.tag.yaml for keys, string.unquoted.plain.out.yaml for values
const yamlHighlightStyle = HighlightStyle.define(
  [
    { tag: tags.propertyName, color: code.keyword },
    { tag: tags.content, color: code.string },
  ],
  { scope: yamlLanguage }
)

// meta.property-name
const cssHighlightStyle = HighlightStyle.define(
  [{ tag: tags.propertyName, color: code.constant }],
  { scope: cssLanguage }
)

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
  // Two classes, so the mark wins over the syntax class inside or around it.
  ".cm-content .cm-pico-constant, .cm-content .cm-pico-constant *": {
    color: code.constant,
  },
  ".cm-content .cm-pico-function, .cm-content .cm-pico-function *": {
    color: code.function,
  },
  ".cm-content .cm-pico-plain, .cm-content .cm-pico-plain *": {
    color: "var(--code-fg)",
  },
  ".cm-content .cm-pico-keyword, .cm-content .cm-pico-keyword *": {
    color: code.keyword,
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

/** A saved comment on lines of this file. */
export type ProjectFileEditorComment = FileCommentRange & {
  id: string
  text: string
}

export type ProjectFileEditorProps = {
  path: string
  /** The document. The editor reads it at the start and on a new `docVersion`. */
  doc: string
  docVersion: string
  readOnly: boolean
  onChange: (doc: string) => void
  onSave: () => void
  comments: Array<ProjectFileEditorComment>
  /** False hides the comment buttons, for example with unsaved changes. */
  canComment: boolean
  commentDisabledReason?: string
  onAddComment?: (
    range: FileCommentRange,
    text: string,
    snippet: string
  ) => void
  onRemoveComment?: (id: string) => void
}

function FileCommentNote({
  text,
  onRemove,
}: {
  text: string
  onRemove?: () => void
}) {
  return (
    <div className="my-1 ml-2 inline-flex max-w-[min(32rem,calc(100%_-_1rem))] items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 py-0.5 pr-0.5 pl-2 font-sans text-[11px] text-amber-800 dark:text-amber-200">
      <span className="shrink-0">💬</span>
      <span className="truncate" title={text}>
        {text}
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove comment"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-amber-500/20"
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

function commentTitle(path: string, range: FileCommentRange) {
  return `Comment on ${formatComposerFileLineCommentReference({ path, ...range })}`
}

export default function ProjectFileEditor({
  path,
  doc,
  docVersion,
  readOnly,
  onChange,
  onSave,
  comments,
  canComment,
  commentDisabledReason,
  onAddComment,
  onRemoveComment,
}: ProjectFileEditorProps) {
  const [pendingComment, setPendingComment] =
    React.useState<FileCommentRange | null>(null)
  const commentHandlers = React.useRef<FileCommentHandlers>({
    start: () => {},
  })
  commentHandlers.current = {
    start: (range) => {
      if (onAddComment) setPendingComment(range)
    },
  }
  // One element for each comment widget; React draws into it.
  const commentContainers = React.useRef(new Map<string, HTMLElement>())
  const commentContainer = (key: string) => {
    let element = commentContainers.current.get(key)
    if (!element) {
      element = document.createElement("div")
      element.className = "cm-pico-comment-block"
      commentContainers.current.set(key, element)
    }
    return element
  }
  const pendingKey = pendingComment
    ? `pending:${pendingComment.startLine}-${pendingComment.endLine}`
    : ""
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
          syntaxHighlighting(jsonHighlightStyle),
          syntaxHighlighting(yamlHighlightStyle),
          syntaxHighlighting(cssHighlightStyle),
          syntaxHighlighting(picoHighlightStyle),
          picoEditorTheme,
          EditorView.lineWrapping,
          fileCommentsExtension(commentHandlers),
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
        effects: languageCompartment.reconfigure(
          withPicoStyleTags(description, support)
        ),
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

  // Comments are off with unsaved changes: close an open form.
  const commentsOn = canComment && Boolean(onAddComment)
  React.useEffect(() => {
    if (!commentsOn) setPendingComment(null)
  }, [commentsOn])

  // Give CodeMirror the layout of the notes and the open form.
  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setFileCommentLayout.of({
        canComment: commentsOn,
        disabledReason: commentDisabledReason,
        notes: comments.map((comment) => ({
          startLine: comment.startLine,
          endLine: comment.endLine,
          container: commentContainer(comment.id),
        })),
        pending: pendingComment
          ? { ...pendingComment, container: commentContainer(pendingKey) }
          : null,
      }),
    })
    // Drop the elements of comments that are gone.
    const keys = new Set([...comments.map((comment) => comment.id), pendingKey])
    for (const key of commentContainers.current.keys())
      if (!keys.has(key)) commentContainers.current.delete(key)
    // commentContainer only reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, commentsOn, commentDisabledReason, pendingComment, pendingKey])

  const submitComment = (text: string) => {
    const view = viewRef.current
    if (!view || !pendingComment) return
    const doc = view.state.doc
    const start = Math.min(Math.max(1, pendingComment.startLine), doc.lines)
    const end = Math.min(Math.max(start, pendingComment.endLine), doc.lines)
    const lines: Array<string> = []
    for (let line = start; line <= end; line += 1)
      lines.push(doc.line(line).text)
    onAddComment?.(
      { startLine: start, endLine: end },
      text,
      fileLineCommentSnippet(lines)
    )
    setPendingComment(null)
    view.dispatch({ selection: { anchor: view.state.selection.main.head } })
  }

  return (
    <>
      <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
      {pendingComment
        ? createPortal(
            <LineCommentForm
              key={pendingKey}
              title={commentTitle(path, pendingComment)}
              onCancel={() => setPendingComment(null)}
              onSubmit={submitComment}
            />,
            commentContainer(pendingKey),
            pendingKey
          )
        : null}
      {comments.map((comment) =>
        createPortal(
          <FileCommentNote
            text={comment.text}
            onRemove={
              onRemoveComment ? () => onRemoveComment(comment.id) : undefined
            }
          />,
          commentContainer(comment.id),
          comment.id
        )
      )}
    </>
  )
}
