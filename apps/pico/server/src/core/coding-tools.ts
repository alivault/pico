/**
 * The coding tools (read, write, edit, bash), with a shell prefix before every
 * bash command: pi's `shellCommandPrefix` setting, as pi's own CLI applies it.
 * A prefix such as `set -u` makes an unset variable an error, so a command like
 * `rm -rf "$DIR"/*` cannot run with `$DIR` empty. `shellPrefix` is read on each
 * call, so a change to the setting applies without a restart.
 *
 * `guard` can refuse a command before it runs (the bash guard of child
 * sessions, see `profiles.ts`): it returns the reason.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  defineExtension,
  type ConversationId,
} from "@earendil-works/pi-durable"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ReadToolOptions,
} from "@earendil-works/pi-durable/tools"

import type { HostBridge } from "../extensions/host.ts"
import { sessionIdOf } from "../extensions/host.ts"
import { bashGuard } from "./profiles.ts"

const run = promisify(execFile)

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
 * Why a session may not run a command, or undefined. Only child sessions
 * (sessions with a parent) have a guard.
 */
export async function childCommandRefusal(
  host: HostBridge | undefined,
  conversationId: ConversationId,
  command: string,
  cwd: string
) {
  const sessions = host?.current?.sessions
  const id = sessionIdOf(conversationId)
  if (!sessions?.has(id)) return undefined
  const meta = sessions.meta(id)
  if (!meta.parent) return undefined
  return bashGuard(command, {
    cwd,
    ...(meta.limits?.denyCommands
      ? { denyCommands: meta.limits.denyCommands }
      : {}),
    currentBranch,
  })
}

export function createPicoCodingTools(options: {
  images?: ReadToolOptions["images"]
  shellPrefix: () => string | undefined
  host?: HostBridge
}) {
  return defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(options.images ? { images: options.images } : {}),
      createWriteTool(),
      createEditTool(),
      createBashTool({
        prepare: async (execution, api) => {
          const refusal = await childCommandRefusal(
            options.host,
            api.conversationId,
            execution.command,
            execution.cwd
          )
          if (refusal)
            throw new Error(
              `${refusal}. Ask your parent session: end your turn with a message that starts with "Question:".`
            )
          const prefix = options.shellPrefix()
          if (prefix) execution.command = `${prefix}\n${execution.command}`
        },
      }),
    ],
  })
}
