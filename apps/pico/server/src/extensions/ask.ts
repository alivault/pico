/**
 * The `ask` extension: `ask_user` asks the user a structured question and
 * waits for the answer.
 *
 * The question is a conversation document, so it survives a restart: the tool
 * is replay-safe, and a rerun finds the same question (keyed by the call ID)
 * and waits again, or returns at once when the answer came in meanwhile. The
 * web client answers through `answerQuestion()`. A chat message that the user
 * sends while a question is open also answers it.
 */
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type ConversationId,
  type Harness,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"

import { json, registerState, textResult } from "./util.ts"

export type QuestionOption = { label: string; description?: string }

export type QuestionField = {
  name: string
  label?: string
  type?: "text" | "textarea" | "number" | "boolean" | "select"
  options?: string[]
  required?: boolean
  placeholder?: string
}

export type QuestionAnswer = {
  /** A string, the chosen labels, or form values by field name. */
  value: string | string[] | Record<string, string>
  /** The answer as text, for the model. */
  text: string
  at: number
  via: "ui" | "chat"
}

export type Question = {
  id: string
  prompt: string
  kind: "choice" | "multi" | "text" | "form" | "confirm"
  options?: QuestionOption[]
  fields?: QuestionField[]
  allowOther?: boolean
  placeholder?: string
  createdAt: number
  answer?: QuestionAnswer
  cancelled?: boolean
}

export type QuestionsState = { items: Record<string, Question> }

export const QuestionsDoc = defineDoc<QuestionsState>({
  kind: "pico.questions",
  checkpointWhen: () => false,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: {} }),
})

const MAX_KEPT = 40

export function pendingQuestions(state: QuestionsState | undefined | null) {
  return Object.values(state?.items ?? {})
    .filter((question) => !question.answer && !question.cancelled)
    .sort((left, right) => left.createdAt - right.createdAt)
}

function answerText(question: Question, value: QuestionAnswer["value"]) {
  if (typeof value === "string") return value
  if (Array.isArray(value))
    return value.length > 0 ? value.join(", ") : "(nothing selected)"
  return (question.fields ?? Object.keys(value).map((name) => ({ name })))
    .map((field) => `${field.name}: ${value[field.name] ?? ""}`)
    .join("\n")
}

/**
 * Answer a question. Returns false when it does not exist or is closed.
 * With no `questionId`, answer the oldest open question.
 */
export async function answerQuestion(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  questionId: string | undefined,
  value: QuestionAnswer["value"],
  via: QuestionAnswer["via"],
  context: Context
) {
  return harness.commit(async (tx) => {
    const draft = (await tx.doc(
      QuestionsDoc,
      conversationId
    )) as unknown as QuestionsState
    const question = questionId
      ? draft.items[questionId]
      : pendingQuestions(draft)[0]
    if (!question || question.answer || question.cancelled) return false
    question.answer = json({
      value,
      text: answerText(question, value),
      at: Date.now(),
      via,
    })
    return true
  }, context)
}

/** Close every open question, for an abort. */
export async function cancelQuestions(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  context: Context
) {
  await harness.commit(async (tx) => {
    const draft = (await tx.doc(
      QuestionsDoc,
      conversationId
    )) as unknown as QuestionsState
    for (const question of pendingQuestions(draft)) question.cancelled = true
  }, context)
}

function waitForAnswer(
  api: ToolExecutionApi,
  questionId: string,
  context: Context
): Promise<Question> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (question: Question | undefined, error?: unknown) => {
      if (settled) return
      settled = true
      context.abortSignal?.removeEventListener("abort", onAbort)
      void watch?.stop()
      if (question) resolve(question)
      else reject(error ?? new Error("The question was closed"))
    }
    const onAbort = () =>
      finish(undefined, context.abortSignal?.reason ?? new Error("Aborted"))
    const check = (state: Readonly<QuestionsState> | null | undefined) => {
      const question = state?.items[questionId]
      if (question?.answer || question?.cancelled) finish(json(question))
    }
    let watch:
      | Awaited<ReturnType<typeof api.watchDoc<QuestionsState>>>
      | undefined
    context.abortSignal?.addEventListener("abort", onAbort, { once: true })
    void api
      .watchDoc(QuestionsDoc, api.conversationId, context)
      .then((handle) => {
        watch = handle
        if (!handle) {
          finish(undefined, new Error("The question document is missing"))
          return
        }
        if (settled) {
          void handle.stop()
          return
        }
        check(handle.value)
        handle.start(async (value) => check(value))
      })
      .catch((error: unknown) => finish(undefined, error))
  })
}

const optionSchema = Type.Union([
  Type.String(),
  Type.Object({
    label: Type.String(),
    description: Type.Optional(Type.String()),
  }),
])

const fieldSchema = Type.Object({
  name: Type.String(),
  label: Type.Optional(Type.String()),
  type: Type.Optional(
    Type.Union(
      ["text", "textarea", "number", "boolean", "select"].map((kind) =>
        Type.Literal(kind)
      )
    )
  ),
  options: Type.Optional(Type.Array(Type.String())),
  required: Type.Optional(Type.Boolean()),
  placeholder: Type.Optional(Type.String()),
})

const askTool = defineTool({
  name: "ask_user",
  description: [
    "Ask the user a question and wait for the answer. The run pauses until the user answers in the web client, also hours later and after a server restart.",
    "Use it when you need a decision or information that you cannot find yourself. Do not use it for questions you can answer by reading the code.",
    "Kinds: choice (one of options), multi (several of options), confirm (yes or no), text (free text), form (named fields).",
  ].join(" "),
  parameters: Type.Object({
    question: Type.String({ description: "The question, in markdown" }),
    kind: Type.Optional(
      Type.Union(
        ["choice", "multi", "text", "form", "confirm"].map((kind) =>
          Type.Literal(kind)
        )
      )
    ),
    options: Type.Optional(Type.Array(optionSchema)),
    allow_other: Type.Optional(
      Type.Boolean({
        description: "Let the user type an answer that is not an option",
      })
    ),
    fields: Type.Optional(Type.Array(fieldSchema)),
    placeholder: Type.Optional(Type.String()),
  }),
  replay: "safe",
  async execute(args, api, context) {
    const options = (args.options ?? []).map((option) =>
      typeof option === "string" ? { label: option } : option
    )
    const kind =
      args.kind ??
      (args.fields?.length ? "form" : options.length > 0 ? "choice" : "text")
    const id = api.callId
    await api.commit(async (tx) => {
      const draft = (await tx.doc(
        QuestionsDoc,
        api.conversationId
      )) as unknown as QuestionsState
      if (draft.items[id]) return
      draft.items[id] = json({
        id,
        prompt: args.question,
        kind,
        ...(options.length > 0 ? { options } : {}),
        ...(args.fields?.length ? { fields: args.fields } : {}),
        ...(args.allow_other ? { allowOther: true } : {}),
        ...(args.placeholder ? { placeholder: args.placeholder } : {}),
        createdAt: Date.now(),
      }) as Question
      const closed = Object.values(draft.items)
        .filter((question) => question.answer || question.cancelled)
        .sort((left, right) => left.createdAt - right.createdAt)
      for (const old of closed.slice(
        0,
        Math.max(0, Object.keys(draft.items).length - MAX_KEPT)
      ))
        delete draft.items[old.id]
    }, context)
    await api.details({ questionId: id, status: "waiting" }, context)
    const question = await waitForAnswer(api, id, context)
    if (question.cancelled || !question.answer) {
      return textResult("The user closed the question without an answer.", {
        isError: true,
        details: { questionId: id, status: "cancelled" },
      })
    }
    const answer = question.answer
    const text =
      answer.via === "chat"
        ? `The user answered in chat: ${answer.text}`
        : `The user answered: ${answer.text}`
    return textResult(text, {
      details: json({ questionId: id, status: "answered", answer }),
    })
  },
})

registerState({
  key: "questions",
  kinds: ["pico.questions"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(QuestionsDoc, conversationId, context)
    const pending = pendingQuestions(state as QuestionsState | undefined)
    return pending.length > 0 ? json(pending) : undefined
  },
})

export function createAskExtension() {
  return defineExtension({ name: "ask", tools: [askTool] })
}
