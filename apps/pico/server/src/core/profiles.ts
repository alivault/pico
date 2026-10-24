/**
 * Tool profiles: named selections of extensions and tools for a session.
 *
 * A profile is a capability choice, not an approval system: tools that a
 * profile keeps still run without asking. Built-in profiles are below; the
 * `profiles` setting adds more or replaces one by name.
 *
 * Child sessions (sessions with a parent) get more limits: no `ask_user`,
 * `notify`, or `spawn_session` unless the parent grants them, and a bash
 * guard (see `bashGuard`). The parent can add and remove tools for each child.
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

/** The tool limits of one session, kept in its metadata. */
export type ToolLimits = {
  /** Tools to turn on, also when the profile or the child rules remove them. */
  add?: string[]
  /** Tools to turn off. */
  remove?: string[]
  /** Commands that bash refuses, in addition to the child rules. */
  denyCommands?: string[]
}

/** Tools that a child session does not get unless its parent grants them. */
export const CHILD_DENIED_TOOLS = [
  "ask_user",
  "notify",
  "spawn_session",
  "job_focus",
]

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
    name: "builder",
    description:
      "Build and change code: files, shell, git, tests, and language servers. No browser and no other sessions.",
    removeTools: [
      "browser_open",
      "browser_snapshot",
      "browser_act",
      "browser_screenshot",
      "browser_eval",
      "browser_tabs",
      "browser_close",
      "send_to_session",
      "stop_session",
      "archive_sessions",
    ],
    instructions:
      "You are a builder: make the change, run the checks and tests, and report what you changed and what you did not do.",
  },
  {
    name: "researcher",
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
      "todo",
    ],
    removeTools: ["write", "edit", "bash", "browser_eval"],
    instructions:
      "You are a researcher: find and read sources, then report with links. Do not change files.",
  },
  {
    name: "reviewer",
    description:
      "Review changes: diffs, other sessions, pull requests, and tests. No file changes.",
    removeTools: WRITE_TOOLS.filter(
      (tool) => tool !== "bash" && tool !== "send_to_session"
    ),
    instructions:
      "You are a reviewer: read the diff (git_diff, gh_pr diff, read_session), run the tests, and report problems with file and line. Do not change files.",
  },
  {
    name: "read-only",
    description:
      "Read and analyze code, with git history, language servers, tests, and the web. No file changes.",
    removeTools: WRITE_TOOLS.filter((tool) => tool !== "bash"),
    instructions:
      "You are in read-only mode: do not change files or the repository. Use bash only for commands that do not change anything.",
  },
]

/** Old names of built-in profiles. */
const ALIASES: Record<string, string> = {
  research: "researcher",
  review: "reviewer",
}

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
  const profiles = allProfiles(custom)
  return (
    profiles.find((profile) => profile.name === name) ??
    profiles.find((profile) => profile.name === ALIASES[name])
  )
}

/** Clean a list of names from tool arguments or settings. */
export function nameList(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const names = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
  return names.length > 0 ? [...new Set(names)] : undefined
}

/** What a session gets: the extensions, the removed tools, and the prompt text. */
export function resolveSelection(
  registry: RegistryReader,
  profile: Profile | undefined,
  options: { child?: { parent: string }; limits?: ToolLimits } = {}
) {
  const snapshot = registry.snapshot()
  const add = new Set(options.limits?.add ?? [])
  const removeNames = new Set([
    ...(profile?.removeTools ?? []),
    ...(options.limits?.remove ?? []),
    ...(options.child ? CHILD_DENIED_TOOLS : []),
  ])
  for (const name of add) removeNames.delete(name)
  let extensions: Extension[] | null = null
  if (profile?.extensions) {
    const names = [...profile.extensions]
    // A tool that the parent adds brings its extension.
    for (const { tool, extension } of snapshot.tools())
      if (add.has(tool.name) && !names.includes(extension.name))
        names.push(extension.name)
    extensions = names.flatMap((name) => {
      const extension = snapshot.extension(name)
      return extension ? [extension] : []
    })
  }
  const kept = new Set(
    extensions ? extensions.map((extension) => extension.name) : undefined
  )
  const removeTools: ToolRegistration[] = []
  const removed: string[] = []
  const seen = new Set<string>()
  for (const { tool, extension } of snapshot.tools()) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    if (extensions && !kept.has(extension.name)) {
      removed.push(tool.name)
      continue
    }
    if (!removeNames.has(tool.name)) continue
    removeTools.push(tool)
    removed.push(tool.name)
  }
  const parts: string[] = []
  if (profile?.instructions) parts.push(profile.instructions)
  if (options.child)
    parts.push(
      childInstructions(options.child.parent, profile, removed, options.limits)
    )
  return {
    extensions,
    removeTools,
    instructions: parts.length > 0 ? parts.join("\n\n") : null,
  }
}

function childInstructions(
  parent: string,
  profile: Profile | undefined,
  removed: string[],
  limits: ToolLimits | undefined
) {
  const deny = [
    "git push to main or master",
    "sudo",
    ...(limits?.denyCommands ?? []).map((command) => `\`${command}\``),
  ]
  return [
    `You are a child session of session ${parent}. Your parent gave you this work and limited your tools${profile && profile.name !== "full" ? ` (profile: ${profile.name})` : ""}.`,
    removed.length > 0
      ? `You do not have these tools: ${removed.sort().join(", ")}.`
      : "",
    `Bash refuses: ${deny.join(", ")}.`,
    "If you need a tool, a command, or a decision, do not wait and do not work around the limit. End your turn with a message that starts with `Question:`. Give the question, the options, and your recommendation. Your parent reads it and answers you, and it can give you more tools.",
    "When the work is done, end your turn with a short report of what you did.",
    "If you end your turn to wait on a timer, a watch, or a job, your parent gets no message: it gets one when you end with a question or with done.",
  ]
    .filter(Boolean)
    .join(" ")
}

/**
 * Configure a conversation for a profile. `undefined` or `full` clears the
 * profile's choices, so the conversation follows the host defaults again.
 * A child always keeps the child limits.
 */
export async function applyProfile(
  conversation: Pick<Conversation, "configure">,
  registry: RegistryReader,
  profile: Profile | undefined,
  context: Context,
  options: { child?: { parent: string }; limits?: ToolLimits } = {}
) {
  const selection = resolveSelection(registry, profile, options)
  await conversation.configure(
    {
      extensions: selection.extensions,
      tools:
        selection.removeTools.length > 0
          ? { remove: selection.removeTools }
          : null,
      instructions: selection.instructions,
    },
    context
  )
}

// -----------------------------------------------------------------------------
// The bash guard of child sessions

/** Shell words of a command, split into simple commands at `;`, `&`, `|`, newlines, and `(`. */
function simpleCommands(command: string) {
  const segments: string[][] = []
  let words: string[] = []
  let word = ""
  let quote: string | undefined
  const endWord = () => {
    if (word) words.push(word)
    word = ""
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote) {
      if (char === quote) quote = undefined
      else if (char === "\\" && quote === '"' && index + 1 < command.length)
        word += command[++index]
      else word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "\\" && index + 1 < command.length) {
      word += command[++index]
      continue
    }
    if (/\s/.test(char)) {
      if (char === "\n") endSegment()
      else endWord()
      continue
    }
    if (";&|()`{}".includes(char)) {
      endSegment()
      continue
    }
    if (char === "$" && command[index + 1] === "(") {
      endSegment()
      index += 1
      continue
    }
    word += char
  }
  endSegment()
  const result: string[][] = []
  for (const segment of segments) {
    result.push(segment)
    // `bash -c "…"` and `sh -c '…'`: check the inner command too.
    const shell = segment.findIndex((item) =>
      /^(?:.*\/)?(?:ba|z|da|k)?sh$/.test(item)
    )
    const flag = shell >= 0 ? segment.indexOf("-c", shell) : -1
    if (flag >= 0 && segment[flag + 1])
      result.push(...simpleCommands(segment[flag + 1]!))
  }
  return result
}

/** The words of a simple command without leading `VAR=value`, `env`, `command`, `exec`, or `time`. */
function commandWords(words: string[]) {
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) index += 1
    else if (["env", "command", "exec", "time", "nohup", "!"].includes(word))
      index += 1
    else break
  }
  return words.slice(index)
}

const PROTECTED_BRANCHES = new Set(["main", "master"])

/** The branch that a refspec writes to, for example `HEAD:main` gives `main`. */
function destination(refspec: string) {
  const target = refspec.replace(/^\+/, "").split(":").at(-1) ?? ""
  return target.replace(/^refs\/heads\//, "")
}

/**
 * Why a `git push` writes to main, or undefined. `currentBranch` reads the
 * branch of a directory, for a push without a refspec.
 */
async function pushToMain(
  words: string[],
  cwd: string,
  currentBranch: (dir: string) => Promise<string | undefined>
) {
  if (words[0] !== "git" && !words[0]?.endsWith("/git")) return undefined
  let index = 1
  let dir = cwd
  while (index < words.length && words[index]!.startsWith("-")) {
    const option = words[index]!
    if (option === "-C" && words[index + 1]) {
      const next = words[index + 1]!
      dir = next.startsWith("/") ? next : `${dir}/${next}`
      index += 2
    } else if (option === "-c" && words[index + 1]) index += 2
    else index += 1
  }
  if (words[index] !== "push") return undefined
  const rest = words.slice(index + 1)
  if (rest.some((word) => word === "--all" || word === "--mirror"))
    return "git push --all and --mirror write to main"
  const positional: string[] = []
  for (let item = 0; item < rest.length; item += 1) {
    const word = rest[item]!
    if (word.startsWith("-")) {
      // Options that take a separate value.
      if (["-o", "--push-option", "--repo", "--receive-pack"].includes(word))
        item += 1
      continue
    }
    positional.push(word)
  }
  const refspecs = positional.slice(1)
  if (refspecs.some((refspec) => PROTECTED_BRANCHES.has(destination(refspec))))
    return "git push to main or master"
  if (
    refspecs.length === 0 ||
    refspecs.some((spec) => /^\+?HEAD$/.test(spec))
  ) {
    const branch = await currentBranch(dir)
    if (branch && PROTECTED_BRANCHES.has(branch))
      return `git push from branch ${branch}`
  }
  return undefined
}

/** True when the words start with the denied command, word by word. */
function startsWith(words: string[], denied: string[]) {
  if (denied.length === 0 || words.length < denied.length) return false
  return denied.every((part, index) => {
    const word = words[index]!
    return index === 0
      ? word === part || word.endsWith(`/${part}`)
      : word === part
  })
}

/**
 * The reason a child session may not run a command, or undefined. It refuses
 * `git push` to main or master, `sudo`, and the commands in `denyCommands`
 * (each one a command with its first words, for example `npm publish`). It
 * is a guard against mistakes, not a sandbox.
 */
export async function bashGuard(
  command: string,
  options: {
    cwd: string
    denyCommands?: string[]
    currentBranch: (dir: string) => Promise<string | undefined>
  }
) {
  const denied = (options.denyCommands ?? [])
    .map((entry) => entry.trim().split(/\s+/).filter(Boolean))
    .filter((entry) => entry.length > 0)
  for (const segment of simpleCommands(command)) {
    let words = commandWords(segment)
    if (
      words[0] === "sudo" ||
      words[0]?.endsWith("/sudo") ||
      words[0] === "doas"
    )
      return "sudo is not allowed in a child session"
    for (const entry of denied)
      if (startsWith(words, entry))
        return `\`${entry.join(" ")}\` is not allowed in this child session`
    words = commandWords(words)
    const push = await pushToMain(words, options.cwd, options.currentBranch)
    if (push) return `${push} is not allowed in a child session`
  }
  return undefined
}
