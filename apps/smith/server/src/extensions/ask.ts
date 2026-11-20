/**
 * The `ask` extension: `ask_user` asks the user a structured question and
 * waits for the answer.
 *
 * The question is a conversation document, so it survives a restart: the tool
 * is replay-safe, and a rerun finds the same question (keyed by the call ID)
 * and waits again, or returns at once when the answer came in meanwhile. The
 * web client answers through `answerQuestion()`. A chat message that the user
 * sends while a question is open also answers it.
 *
 * Agents often end a turn with a question in plain text, as in a chat, even
 * when told to use `ask_user`. The `onYield` hook catches a final answer that
 * ends with a question and asks the agent one time to ask it with the tool.
 */
import type { Context } from "@earendil-works/chord/context"
import Type from "typebox"
import type { AssistantMessage, Message } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  type Agent,
  type ConversationId,
  type Harness,
  type HookApi,
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
  /** Images that the user pasted into the answer. */
  images?: Array<{ type: "image"; mimeType: string; data: string }>
}

export type Question = {
  id: string
  prompt: string
  kind: "choice" | "multi" | "text" | "form" | "confirm"
  options?: QuestionOption[]
  fields?: QuestionField[]
  allowOther?: boolean
  placeholder?: string
  /** A browser handoff: the user uses the agent's browser, then answers. */
  browser?: boolean
  createdAt: number
  answer?: QuestionAnswer
  cancelled?: boolean
}

export type QuestionsState = { items: Record<string, Question> }

export const QuestionsDoc = defineDoc<QuestionsState>({
  kind: "smith.questions",
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
  context: Context,
  images: NonNullable<QuestionAnswer["images"]> = []
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
      ...(images.length > 0 ? { images } : {}),
    })
    return true
  }, context)
}

/**
 * Close the open questions, for an abort. With `ids`, close only those
 * questions, for example the question of a tool call that ended.
 */
export async function cancelQuestions(
  harness: Pick<Harness, "commit">,
  conversationId: ConversationId,
  context: Context,
  ids?: readonly string[]
) {
  await harness.commit(async (tx) => {
    const draft = (await tx.doc(
      QuestionsDoc,
      conversationId
    )) as unknown as QuestionsState
    for (const question of pendingQuestions(draft))
      if (!ids || ids.includes(question.id)) question.cancelled = true
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
        handle.start(async (call) => {
          if (call.kind === "value") check(call.value)
        })
      })
      .catch((error: unknown) => finish(undefined, error))
  })
}

/**
 * Ask a question, keyed by the tool call ID, and wait for its answer. A
 * rerun after a restart finds the same question.
 */
export async function askAndWait(
  api: ToolExecutionApi,
  context: Context,
  input: Omit<Question, "id" | "createdAt" | "answer" | "cancelled">
) {
  const id = api.callId
  await api.commit(async (tx) => {
    const draft = (await tx.doc(
      QuestionsDoc,
      api.conversationId
    )) as unknown as QuestionsState
    if (draft.items[id]) return
    draft.items[id] = json({ ...input, id, createdAt: Date.now() }) as Question
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
  return waitForAnswer(api, id, context)
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
      (["text", "textarea", "number", "boolean", "select"] as const).map(
        (kind) => Type.Literal(kind)
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
    "Ask the user a question and wait for the answer. The turn pauses until the user answers in the web client, also hours later and after a server restart.",
    "Use it for every question to the user: a decision or information that you cannot find yourself, and also the offer at the end of a report ('Should I fix X?'). A question in plain text gives the user no buttons. Write your report first, then call ask_user as the last step. Do not use it for questions you can answer by reading the code.",
    "Kinds: choice (one of options), multi (several of options), confirm (yes or no), text (free text), form (named fields).",
  ].join(" "),
  parameters: Type.Object({
    question: Type.String({ description: "The question, in markdown" }),
    kind: Type.Optional(
      Type.Union(
        (["choice", "multi", "text", "form", "confirm"] as const).map((kind) =>
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
    const question = await askAndWait(api, context, {
      prompt: args.question,
      kind,
      ...(options.length > 0 ? { options } : {}),
      ...(args.fields?.length ? { fields: args.fields } : {}),
      ...(args.allow_other ? { allowOther: true } : {}),
      ...(args.placeholder ? { placeholder: args.placeholder } : {}),
    })
    const id = question.id
    if (question.cancelled || !question.answer) {
      return textResult("The user closed the question without an answer.", {
        isError: true,
        details: { questionId: id, status: "cancelled" },
      })
    }
    const { images = [], ...answer } = question.answer
    const attached =
      images.length === 0
        ? ""
        : images.length === 1
          ? "an image"
          : `${images.length} images`
    const text =
      answer.via === "chat"
        ? `The user answered in chat: ${answer.text}`
        : !attached
          ? `The user answered: ${answer.text}`
          : answer.text.trim()
            ? `The user answered with ${attached}: ${answer.text}`
            : `The user answered with ${attached}.`
    return {
      output: [{ type: "text" as const, text }, ...images],
      details: json({ questionId: id, status: "answered", answer }),
    }
  },
})

registerState({
  key: "questions",
  kinds: ["smith.questions"],
  async read(reader, conversationId, context) {
    const state = await reader.snapshot(QuestionsDoc, conversationId, context)
    const pending = pendingQuestions(state as QuestionsState | undefined)
    return pending.length > 0 ? json(pending) : undefined
  },
})

/** The start of the message that asks the agent to use `ask_user`. */
export const PLAIN_QUESTION_MARKER = "[Plain-text question]"

const PLAIN_QUESTION_NUDGE = [
  `${PLAIN_QUESTION_MARKER} Your last message ends with a question to the user in plain text. The user cannot answer it with a click.`,
  "Ask it again with ask_user: put the most likely options first and your recommendation at the top. Do not repeat your report.",
  "If it was not a question for the user, reply with one short line and no question.",
].join("\n")

/**
 * True when the end of a final answer asks the user something: one of its
 * last lines ends with a question mark, outside code.
 */
export function endsWithQuestion(text: string) {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  return lines
    .slice(-3)
    .some((line) => /\?[\s*_)"'”’`]*$/.test(line.replace(/`[^`]*`/g, "")))
}

function textOf(message: Pick<Message, "content">) {
  const { content } = message
  if (typeof content === "string") return content
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
}

/** The agent's offered tools. Hooks get the generation runtime, which has them. */
async function offersAskUser(api: HookApi, context: Context) {
  const withAgent = api as HookApi & {
    agent?: (context: Context) => Promise<Agent>
  }
  if (typeof withAgent.agent !== "function") return false
  const agent = await withAgent.agent(context)
  return agent.tools.some((tool) => tool.name === "ask_user")
}

/** True when the last user message of the run is the nudge: ask one time. */
async function nudgedAlready(api: HookApi, context: Context) {
  const page = await api.entries({}, 30, undefined, context)
  for (const entry of page.items) {
    const user = entry.model?.find((message) => message.role === "user")
    if (user) return textOf(user).startsWith(PLAIN_QUESTION_MARKER)
  }
  return false
}

const plainQuestionHook = hook(GenerationTask, {
  async onYield(answer: AssistantMessage, api, context) {
    if (!endsWithQuestion(textOf(answer))) return undefined
    if (!(await offersAskUser(api, context))) return undefined
    if (await nudgedAlready(api, context)) return undefined
    return { continue: PLAIN_QUESTION_NUDGE }
  },
})

export function createAskExtension() {
  return defineExtension({
    name: "ask",
    tools: [askTool],
    hooks: [plainQuestionHook],
  })
}
