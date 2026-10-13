/**
 * Tool profiles: named selections of extensions and tools for a session.
 *
 * A profile is a capability choice, not an approval system: tools that a
 * profile keeps still run without asking. Built-in profiles are below; the
 * `profiles` setting adds more or replaces one by name.
 */
import type { Context } from "@earendil-works/chord"
import type {
  Conversation,
  Extension,
  RegistryReader,
  ToolRegistration,
} from "@earendil-works/pi-durable"

export type Profile = {
  name: string
  description: string
  /** Exactly these extensions, in this order; absent keeps every extension. */
  extensions?: string[]
  /** Tools to turn off. */
  removeTools?: string[]
  /** Text added to the system prompt. */
  instructions?: string
}

const WRITE_TOOLS = [
  "write",
  "edit",
  "bash",
  "git_commit",
  "git_push",
  "git_pull",
  "git_branch",
  "lsp_rename",
  "job_start",
  "job_stop",
  "browser_act",
  "browser_eval",
  "spawn_session",
  "send_to_session",
  "stop_session",
]

export const BUILTIN_PROFILES: readonly Profile[] = [
  {
    name: "full",
    description: "Every tool. The default.",
  },
  {
    name: "research",
    description:
      "Web research, reading files, notes, and the browser. No shell and no file changes.",
    extensions: [
      "coding-tools",
      "web-access",
      "mcp",
      "tool-search",
      "codemode",
      "pico",
      "ask",
      "render",
      "scratchpad",
      "browser",
      "notify",
      "memory",
      "todo",
    ],
    removeTools: ["write", "edit", "bash", "browser_eval"],
    instructions:
      "You are in research mode: find and read sources, then report. Do not change files.",
  },
  {
    name: "read-only",
    description:
      "Read and analyze code, with git history, language servers, tests, and the web. No file changes.",
    removeTools: WRITE_TOOLS.filter((tool) => tool !== "bash"),
    instructions:
      "You are in read-only mode: do not change files or the repository. Use bash only for commands that do not change anything.",
  },
  {
    name: "review",
    description:
      "Review changes: diffs, other sessions, pull requests, and tests. No file changes.",
    removeTools: WRITE_TOOLS.filter(
      (tool) => tool !== "bash" && tool !== "send_to_session"
    ),
    instructions:
      "You are a reviewer: read the diff (git_diff, gh_pr diff, read_session), run the tests, and report problems with file and line. Do not change files.",
  },
]

/** Built-in profiles, with the user's profiles added or replacing them by name. */
export function allProfiles(
  custom: Record<string, Omit<Profile, "name">> = {}
) {
  const byName = new Map(
    BUILTIN_PROFILES.map((profile) => [profile.name, profile])
  )
  for (const [name, profile] of Object.entries(custom)) {
    if (!/^[a-z0-9][a-z0-9-_]{0,31}$/i.test(name)) continue
    byName.set(name, {
      ...profile,
      name,
      description: profile.description ?? name,
    })
  }
  return [...byName.values()]
}

export function findProfile(
  name: string | undefined,
  custom: Record<string, Omit<Profile, "name">> = {}
) {
  if (!name) return undefined
  return allProfiles(custom).find((profile) => profile.name === name)
}

/**
 * Configure a conversation for a profile. `undefined` or `full` clears the
 * profile's choices, so the conversation follows the host defaults again.
 */
export async function applyProfile(
  conversation: Pick<Conversation, "configure">,
  registry: RegistryReader,
  profile: Profile | undefined,
  context: Context
) {
  const snapshot = registry.snapshot()
  const extensions: Extension[] | null = profile?.extensions
    ? profile.extensions.flatMap((name) => {
        const extension = snapshot.extension(name)
        return extension ? [extension] : []
      })
    : null
  const removeNames = new Set(profile?.removeTools ?? [])
  const removeTools: ToolRegistration[] = []
  if (removeNames.size > 0) {
    const seen = new Set<string>()
    for (const { tool } of snapshot.tools()) {
      if (!removeNames.has(tool.name) || seen.has(tool.name)) continue
      seen.add(tool.name)
      removeTools.push(tool)
    }
  }
  await conversation.configure(
    {
      extensions,
      tools: removeTools.length > 0 ? { remove: removeTools } : null,
      instructions: profile?.instructions ?? null,
    },
    context
  )
}
