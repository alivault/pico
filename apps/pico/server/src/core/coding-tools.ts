/**
 * The coding tools (read, write, edit, bash), with a shell prefix before every
 * bash command: pi's `shellCommandPrefix` setting, as pi's own CLI applies it.
 * A prefix such as `set -u` makes an unset variable an error, so a command like
 * `rm -rf "$DIR"/*` cannot run with `$DIR` empty. `shellPrefix` is read on each
 * call, so a change to the setting applies without a restart.
 *
 * `guard` can refuse a command before it runs (the bash guard of
 * subagents, see `profiles.ts`): it returns the reason. An agent whose
 * profile has `bash: "sandbox"` runs each command in the sandbox of
 * `sandbox.ts`; without the sandbox, it cannot use bash.
 *
 * A bash call cannot wait for input: it runs with editors and pagers set to
 * programs that end at once, git prompts off, and stdin from `/dev/null` (the
 * execution environment starts the shell with stdin ignored). A call without
 * its own timeout stops after `DEFAULT_TIMEOUT_SECONDS`. `bash-calls.ts`
 * tracks each call, for the agents tool and the watchdog of subagents.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { Type } from "@earendil-works/pi-ai"

import {
  defineExtension,
  defineTool,
  type ConversationId,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ReadToolOptions,
} from "@earendil-works/pi-durable/tools"

import type { HostBridge } from "../extensions/host.ts"
import { agentIdOf } from "../extensions/host.ts"
import { endBashCall, ensureWatchdog, startBashCall } from "./bash-calls.ts"
import { bashGuard, findProfile } from "./profiles.ts"
import { sandboxAvailable, sandboxExecution } from "./sandbox.ts"

const run = promisify(execFile)

/** The timeout of a bash call that does not give its own. */
export const DEFAULT_TIMEOUT_SECONDS = 15 * 60

/** The environment of every bash call: nothing can wait for input. */
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
}

const bashParameters = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description: `Timeout in seconds (optional, default ${DEFAULT_TIMEOUT_SECONDS}). For longer work, use job_start.`,
    })
  ),
})

/** The error of a call that the timeout stopped, with what to do instead. */
export function timeoutMessage(seconds: number, isDefault: boolean) {
  return [
    isDefault
      ? `Command timed out after ${seconds} seconds (the default timeout) and was stopped.`
      : `Command timed out after ${seconds} seconds and was stopped.`,
    "Run long work in the background with job_start, or give a larger timeout.",
    "A command that waits for input (an editor, a pager, a prompt) never ends: bash calls get no input.",
  ].join(" ")
}

/** `api` with `output` that also calls `onOutput`. */
function observeOutput(api: ToolExecutionApi, onOutput: () => void) {
  return new Proxy(api, {
    get(target, property) {
      if (property === "output")
        return (...args: Parameters<ToolExecutionApi["output"]>) => {
          onOutput()
          target.output(...args)
        }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

async function currentBranch(dir: string) {
  try {
    const { stdout } = await run(
      "git",
      ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: 5000 }
    )
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Why an agent may not run a command, or undefined. Only subagents
 * (agents with a parent) have a guard.
 */
export async function subagentCommandRefusal(
  host: HostBridge | undefined,
  conversationId: ConversationId,
  command: string,
  cwd: string
) {
  const agents = host?.current?.agents
  const id = agentIdOf(conversationId)
  if (!agents?.has(id)) return undefined
  const meta = agents.meta(id)
  if (!meta.parent) return undefined
  return bashGuard(command, {
    cwd,
    ...(meta.limits?.denyCommands
      ? { denyCommands: meta.limits.denyCommands }
      : {}),
    currentBranch,
  })
}

/** Whether an agent's profile runs bash in the sandbox. */
export function bashSandboxed(
  host: HostBridge | undefined,
  conversationId: ConversationId
) {
  const current = host?.current
  const id = agentIdOf(conversationId)
  if (!current?.agents.has(id)) return false
  const name = current.agents.meta(id).profile
  return findProfile(name, current.settings().profiles)?.bash === "sandbox"
}

export function createPicoCodingTools(options: {
  images?: ReadToolOptions["images"]
  shellPrefix: () => string | undefined
  host?: HostBridge
  /** The timeout of a call without its own, in seconds (for tests). */
  defaultTimeout?: number
}) {
  const defaultTimeout = options.defaultTimeout ?? DEFAULT_TIMEOUT_SECONDS
  const markers = new WeakMap<ToolExecutionApi, string>()
  const bash = createBashTool({
    prepare: async (execution, api) => {
      const refusal = await subagentCommandRefusal(
        options.host,
        api.conversationId,
        execution.command,
        execution.cwd
      )
      if (refusal)
        throw new Error(
          `${refusal}. Ask your parent agent: end your turn with a message that starts with "Question:".`
        )
      const prefix = options.shellPrefix()
      if (prefix) execution.command = `${prefix}\n${execution.command}`
      execution.env = { ...execution.env, ...NON_INTERACTIVE_ENV }
      if (bashSandboxed(options.host, api.conversationId)) {
        if (!(await sandboxAvailable()))
          throw new Error(
            "This agent's profile runs bash only in a sandbox, and the sandbox needs bubblewrap (bwrap) on Linux, which is not available here. Use read and the other tools, or ask the user for another profile."
          )
        await sandboxExecution(execution)
      }
      const marker = markers.get(api)
      if (marker) execution.env.PICO_TOOL_CALL = marker
    },
  })
  return defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(options.images ? { images: options.images } : {}),
      createWriteTool(),
      createEditTool(),
      defineTool({
        ...bash,
        description: `${bash.description.replace(/ Optionally provide a timeout in seconds\.$/, "")} The call stops after ${defaultTimeout / 60} minutes unless you give a timeout in seconds; run longer work with job_start. The command gets no input: stdin is /dev/null, and editors, pagers, and git prompts are off.`,
        parameters: bashParameters,
        async execute(args, api, context) {
          const isDefault = args.timeout === undefined
          const timeout = args.timeout ?? defaultTimeout
          const call = startBashCall({
            agentId: agentIdOf(api.conversationId),
            callId: api.callId,
            command: args.command,
          })
          if (options.host) ensureWatchdog(options.host)
          const observed = observeOutput(api, () => {
            call.lastOutputAt = Date.now()
          })
          markers.set(observed, call.marker)
          try {
            return await bash.execute({ ...args, timeout }, observed, context)
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.startsWith("Command timed out after")
            )
              throw new Error(timeoutMessage(timeout, isDefault))
            throw error
          } finally {
            endBashCall(call)
          }
        },
      }),
    ],
  })
}
