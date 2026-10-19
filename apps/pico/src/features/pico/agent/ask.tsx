import * as React from "react"
import { CheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
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
import { useMachineId } from "@/lib/pico/machine-context"

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

function SendHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Kbd>⌘</Kbd>
      <Kbd>↩</Kbd>
      to send
    </span>
  )
}

function submitOnCommandEnter(event: React.KeyboardEvent, send: () => void) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    send()
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
  const id = React.useId()

  if (question.kind === "confirm") {
    return (
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => onAnswer("yes")}>
          <CheckIcon /> Yes
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onAnswer("no")}
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
      <div className="space-y-3">
        {multi ? (
          <FieldGroup className="gap-2">
            {options.map((option, index) => {
              const optionId = `${id}-option-${index}`
              return (
                <Field key={option.label} orientation="horizontal">
                  <Checkbox
                    id={optionId}
                    disabled={disabled}
                    checked={selected.includes(option.label)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...current, option.label]
                          : current.filter((label) => label !== option.label)
                      )
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={optionId}>{option.label}</FieldLabel>
                    {option.description ? (
                      <FieldDescription>{option.description}</FieldDescription>
                    ) : null}
                  </FieldContent>
                </Field>
              )
            })}
          </FieldGroup>
        ) : (
          <div
            className="flex flex-col gap-1.5"
            role="group"
            aria-label="Choices"
          >
            {options.map((option) => (
              <Button
                key={option.label}
                type="button"
                variant="outline"
                disabled={disabled}
                className="h-auto w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
                onClick={() => onAnswer(option.label)}
              >
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </Button>
            ))}
          </div>
        )}
        {multi ? (
          <Button
            disabled={disabled || selected.length === 0}
            onClick={() => onAnswer(selected)}
          >
            {selected.length > 0 ? `Send ${selected.length} choices` : "Send"}
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
              placeholder="Or type another answer"
              aria-label="Another answer"
            />
            <Button
              disabled={disabled || !text.trim()}
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
      (field) =>
        field.required && field.type !== "boolean" && !form[field.name]?.trim()
    )
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!missing) onAnswer(form)
        }}
      >
        <FieldGroup className="gap-4">
          {fields.map((field) => {
            const fieldId = `${id}-${field.name}`
            const value = form[field.name] ?? ""
            const set = (next: string) =>
              setForm((current) => ({ ...current, [field.name]: next }))
            const label = (
              <FieldLabel htmlFor={fieldId}>
                {field.label ?? field.name}
                {field.required ? (
                  <span className="text-muted-foreground"> (required)</span>
                ) : null}
              </FieldLabel>
            )
            if (field.type === "boolean")
              return (
                <Field key={field.name} orientation="horizontal">
                  <Switch
                    id={fieldId}
                    disabled={disabled}
                    checked={value === "true"}
                    onCheckedChange={(checked) =>
                      set(checked ? "true" : "false")
                    }
                  />
                  {label}
                </Field>
              )
            return (
              <Field key={field.name}>
                {label}
                {field.type === "textarea" ? (
                  <Textarea
                    id={fieldId}
                    disabled={disabled}
                    value={value}
                    placeholder={field.placeholder}
                    onChange={(event) => set(event.target.value)}
                  />
                ) : field.type === "select" ? (
                  <Select
                    value={value || null}
                    onValueChange={(next) => set(String(next ?? ""))}
                    disabled={disabled}
                  >
                    <SelectTrigger id={fieldId} className="w-full">
                      <SelectValue
                        placeholder={`Choose ${(field.label ?? field.name).toLowerCase()}`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={fieldId}
                    disabled={disabled}
                    type={field.type === "number" ? "number" : "text"}
                    value={value}
                    placeholder={field.placeholder}
                    onChange={(event) => set(event.target.value)}
                  />
                )}
              </Field>
            )
          })}
        </FieldGroup>
        <Button disabled={disabled || missing} type="submit">
          Send
        </Button>
      </form>
    )
  }

  const send = () => {
    if (text.trim()) onAnswer(text.trim())
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <Textarea
        disabled={disabled}
        value={text}
        aria-label="Your answer"
        placeholder={question.placeholder ?? "Your answer"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => submitOnCommandEnter(event, send)}
      />
      <div className="flex items-center gap-3">
        <Button disabled={disabled || !text.trim()} type="submit">
          Send
        </Button>
        <SendHint />
      </div>
    </form>
  )
}

function useAnswer(viewerContextId: string, sessionId: string | undefined) {
  const machineId = useMachineId()
  const [sending, setSending] = React.useState(false)
  const answer = (questionId: string, value: AnswerValue) => {
    setSending(true)
    void postSessionJson(
      machineId,
      viewerContextId,
      sessionId,
      "/api/session/answer",
      {
        questionId,
        value,
      }
    )
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setSending(false))
  }
  return { sending, answer }
}

/**
 * The question cards that wait for an answer, with whether each one is in
 * view. The chip above the composer uses this to lead the user back to a card
 * that scrolled out of view.
 */
type WaitingCard = { element: HTMLElement; inView: boolean }
const waitingCards = new Map<string, WaitingCard>()
const waitingCardListeners = new Set<() => void>()

function notifyWaitingCards() {
  for (const listener of waitingCardListeners) listener()
}

function subscribeWaitingCards(listener: () => void) {
  waitingCardListeners.add(listener)
  return () => {
    waitingCardListeners.delete(listener)
  }
}

function waitingCardPrefix(viewerContextId: string, sessionId?: string) {
  return `${viewerContextId}\n${sessionId ?? ""}\n`
}

function useTrackWaitingCard(key: string | undefined) {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (!key || !element) return
    const entry: WaitingCard = { element, inView: true }
    waitingCards.set(key, entry)
    notifyWaitingCards()
    const observer = new IntersectionObserver(([record]) => {
      if (!record) return
      entry.inView = record.isIntersecting
      notifyWaitingCards()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (waitingCards.get(key) === entry) waitingCards.delete(key)
      notifyWaitingCards()
    }
  }, [key, element])
  return setElement
}

function offscreenWaitingCard(prefix: string) {
  for (const [key, card] of waitingCards) {
    if (key.startsWith(prefix) && !card.inView) return card.element
  }
  return null
}

/**
 * Shows above the composer when the agent waits for an answer and its
 * question card is out of view. A click scrolls to the card.
 */
export function WaitingQuestionChip({
  sessionId,
  viewerContextId,
}: {
  sessionId?: string
  viewerContextId: string
}) {
  const prefix = waitingCardPrefix(viewerContextId, sessionId)
  const element = React.useSyncExternalStore(subscribeWaitingCards, () =>
    offscreenWaitingCard(prefix)
  )
  if (!element) return null
  const show = () => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    element.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    })
    element
      .querySelector<HTMLElement>("input, textarea, button:not([disabled])")
      ?.focus({ preventScroll: true })
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mb-1.5 h-7 max-w-full rounded-full border-primary/40 bg-background/90 px-3 text-xs font-normal text-primary shadow-sm backdrop-blur hover:text-primary"
      onClick={show}
    >
      <MessageCircleQuestionIcon className="shrink-0" />
      <span className="truncate">The agent waits for your answer</span>
    </Button>
  )
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
  const trackRef = useTrackWaitingCard(
    waiting && questionId
      ? `${waitingCardPrefix(viewerContextId, sessionId)}${questionId}`
      : undefined
  )

  return (
    <div
      ref={trackRef}
      className={cn(
        "space-y-3 rounded-xl border p-3 text-sm",
        waiting ? "border-primary/40 bg-primary/5" : "bg-muted/20"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-xs font-medium",
          waiting ? "text-primary" : "text-muted-foreground"
        )}
      >
        <MessageCircleQuestionIcon className="size-4" />
        {waiting ? "The agent waits for your answer" : "Question"}
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
        <div className="rounded-lg bg-muted/60 px-3 py-2">
          <span className="block text-xs text-muted-foreground">
            {details.answer?.via === "chat"
              ? "You answered in chat"
              : "Your answer"}
          </span>
          <span className="whitespace-pre-wrap">
            {details.answer?.text ??
              block.output.replace(/^The user answered[^:]*: /, "")}
          </span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {block.isError ? "The question was closed without an answer." : null}
        </div>
      )}
    </div>
  )
}

registerToolRenderer("ask_user", { Card: QuestionCard })
