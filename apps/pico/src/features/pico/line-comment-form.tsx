/**
 * The form for a comment on lines of code, in diffs and in the file viewer.
 * The comment goes into the composer; the next prompt sends it.
 */
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function LineCommentForm({
  title,
  onCancel,
  onSubmit,
}: {
  /** What the comment is about, for example "Comment on src/app.ts:L12". */
  title: string
  onCancel: () => void
  onSubmit: (text: string) => void
}) {
  const [text, setText] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = () => {
    const normalizedText = text.trim()
    if (!normalizedText) return
    onSubmit(normalizedText)
  }

  return (
    <form
      className="m-2 w-[calc(100%_-_1rem)] max-w-[38rem] rounded-lg border border-border/70 bg-background p-2 font-sans shadow-sm"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel line comment"
          onClick={onCancel}
        >
          ×
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        value={text}
        rows={2}
        placeholder="Add a note for the prompt…"
        className="min-h-16 resize-none text-sm"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
          if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!text.trim()}>
          Add to prompt
        </Button>
      </div>
    </form>
  )
}
