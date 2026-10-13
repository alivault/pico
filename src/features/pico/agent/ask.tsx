import * as React from "react"
import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { registerAgentSection } from "@/features/pico/agent/agent-panel"
import { postSessionJson } from "@/features/pico/agent/session-extensions"
import { MarkdownBlock } from "@/features/pico/markdown-renderer"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  useToolRenderContext,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { cn } from "@/lib/utils"

type QuestionOption = { label: string; description?: string }
type QuestionField = {
  name: string
  label?: string
  type?: "text" | "textarea" | "number" | "boolean" | "select"
  options?: Array<string>
  required?: boolean
  placeholder?: string
}
type AnswerValue = string | Array<string> | Record<string, string>

export type Question = {
  id: string
  prompt: string
  kind: "choice" | "multi" | "text" | "form" | "confirm"
  options?: Array<QuestionOption>
  fields?: Array<QuestionField>
  allowOther?: boolean
  placeholder?: string
}

type AskDetails = {
  questionId: string
  status: "waiting" | "answered" | "cancelled"
  answer?: { text: string; via: "ui" | "chat" }
}

/** The question from the tool call's arguments, as the server stores it. */
function questionFromArgs(args: Record<string, unknown>, id: string): Question {
  const options = Array.isArray(args.options)
    ? (args.options as Array<unknown>).map((option) =>
        typeof option === "string"
          ? { label: option }
          : (option as QuestionOption)
      )
    : []
  const fields = Array.isArray(args.fields)
    ? (args.fields as Array<QuestionField>)
    : []
  const kind =
    (args.kind as Question["kind"] | undefined) ??
    (fields.length ? "form" : options.length ? "choice" : "text")
  return {
    id,
    prompt: typeof args.question === "string" ? args.question : "",
    kind,
    options,
    fields,
    allowOther: Boolean(args.allow_other),
    ...(typeof args.placeholder === "string"
      ? { placeholder: args.placeholder }
      : {}),
  }
}

export function QuestionForm({
  disabled,
  onAnswer,
  question,
}: {
  disabled?: boolean
  onAnswer: (value: AnswerValue) => void
  question: Question
}) {
  const [text, setText] = React.useState("")
  const [selected, setSelected] = React.useState<Array<string>>([])
  const [form, setForm] = React.useState<Record<string, string>>({})
  const options = question.options ?? []

  if (question.kind === "confirm") {
    return (
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => onAnswer("yes")} size="sm">
          <CheckIcon /> Yes
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onAnswer("no")}
          size="sm"
          variant="outline"
        >
          <XIcon /> No
        </Button>
      </div>
    )
  }

  if (question.kind === "choice" || question.kind === "multi") {
    const multi = question.kind === "multi"
    return (
      <div className="space-y-2">
        <div className="flex flex-col gap-1.5">
          {options.map((option) => {
            const isSelected = selected.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60",
                  isSelected && "border-primary bg-primary/5"
                )}
                onClick={() => {
                  if (!multi) {
                    onAnswer(option.label)
                    return
                  }
                  setSelected((current) =>
                    current.includes(option.label)
                      ? current.filter((label) => label !== option.label)
                      : [...current, option.label]
                  )
                }}
              >
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {multi ? (
          <Button
            disabled={disabled}
            size="sm"
            onClick={() => onAnswer(selected)}
          >
            Send {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        ) : null}
        {question.allowOther ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (text.trim()) onAnswer(text.trim())
            }}
          >
            <Input
              disabled={disabled}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Another answer"
              className="h-8"
            />
            <Button
              disabled={disabled || !text.trim()}
              size="sm"
              type="submit"
              variant="outline"
            >
              Send
            </Button>
          </form>
        ) : null}
      </div>
    )
  }

  if (question.kind === "form") {
    const fields = question.fields ?? []
    const missing = fields.some(
      (field) => field.required && !form[field.name]?.trim()
    )
    return (
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!missing) onAnswer(form)
        }}
      >
        {fields.map((field) => {
          const value = form[field.name] ?? ""
          const set = (next: string) =>
            setForm((current) => ({ ...current, [field.name]: next }))
          return (
            <label key={field.name} className="block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {field.label ?? field.name}
                {field.required ? " *" : ""}
              </span>
              {field.type === "textarea" ? (
                <Textarea
                  disabled={disabled}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => set(event.target.value)}
                />
              ) : field.type === "boolean" ? (
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value === "true"}
                  onChange={(event) =>
                    set(event.target.checked ? "true" : "false")
                  }
                />
              ) : field.type === "select" ? (
                <select
                  disabled={disabled}
                  value={value}
                  onChange={(event) => set(event.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Choose…</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  disabled={disabled}
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => set(event.target.value)}
                  className="h-8"
                />
              )}
            </label>
          )
        })}
        <Button disabled={disabled || missing} size="sm" type="submit">
          Send
        </Button>
      </form>
    )
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onAnswer(text.trim())
      }}
    >
      <Textarea
        disabled={disabled}
        value={text}
        placeholder={question.placeholder ?? "Your answer"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (text.trim()) onAnswer(text.trim())
          }
        }}
      />
      <Button disabled={disabled || !text.trim()} size="sm" type="submit">
        Send
      </Button>
    </form>
  )
}

function useAnswer(viewerContextId: string, sessionId: string | undefined) {
  const [sending, setSending] = React.useState(false)
  const answer = (questionId: string, value: AnswerValue) => {
    setSending(true)
    void postSessionJson(viewerContextId, sessionId, "/api/session/answer", {
      questionId,
      value,
    })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setSending(false))
  }
  return { sending, answer }
}

function QuestionCard({ block }: ToolRendererProps) {
  const { viewerContextId, sessionId } = useToolRenderContext()
  const details = toolDetails<AskDetails>(block)
  const questionId = details.questionId ?? block.callId ?? ""
  const question = questionFromArgs(toolArgs(block), questionId)
  const { sending, answer } = useAnswer(viewerContextId, sessionId)
  const waiting = block.running && details.status !== "answered"
  const answered =
    details.status === "answered" || (!block.running && !block.isError)

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border p-3 text-sm",
        waiting ? "border-primary/40 bg-primary/5" : "bg-muted/20"
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <MessageCircleQuestionIcon className="size-4" />
        {waiting ? "Waiting for your answer" : "Question"}
        {sending ? <Spinner size="xs" /> : null}
      </div>
      {question.prompt ? <MarkdownBlock text={question.prompt} /> : null}
      {waiting && questionId ? (
        <QuestionForm
          disabled={sending}
          question={question}
          onAnswer={(value) => answer(questionId, value)}
        />
      ) : answered ? (
        <div className="rounded-md border bg-background px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {details.answer?.via === "chat" ? "Answered in chat: " : "Answer: "}
          </span>
          <span className="whitespace-pre-wrap">
            {details.answer?.text ??
              block.output.replace(/^The user answered[^:]*: /, "")}
          </span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {block.isError ? "Closed without an answer." : null}
        </div>
      )}
    </div>
  )
}

function PendingQuestionsSection({
  sessionId,
  state,
  viewerContextId,
}: {
  sessionId: string
  state: Record<string, unknown>
  viewerContextId: string
}) {
  const questions = (state.questions as Array<Question> | undefined) ?? []
  const { sending, answer } = useAnswer(viewerContextId, sessionId)
  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <div
          key={question.id}
          className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-sm"
        >
          <MarkdownBlock text={question.prompt} />
          <QuestionForm
            disabled={sending}
            question={question}
            onAnswer={(value) => answer(question.id, value)}
          />
        </div>
      ))}
    </div>
  )
}

registerToolRenderer("ask_user", { Card: QuestionCard })

registerAgentSection({
  key: "questions",
  title: "Waiting for you",
  order: 10,
  visible: (state) =>
    Array.isArray(state.questions) && state.questions.length > 0,
  Component: PendingQuestionsSection,
})
