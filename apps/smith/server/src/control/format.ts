/**
 * Text for the MCP server and the `pico-app agent` command: agent lists and
 * the results of runs.
 */
import type {
  AgentInfo,
  AgentListItem,
  RunState,
  WaitResult,
} from "./agent-ops.ts"

/** The state of a listed agent, in a few words. */
export function listState(item: AgentListItem) {
  if (item.needsInput) return "needs input"
  if (item.busy) return "working"
  if (item.waiting) return `waiting on ${item.waiting}`
  return item.unread ? "done, unread" : "idle"
}

/**
 * One line for each agent: ID, state, title, and directory, in columns.
 * The tool calls that run now follow a working agent.
 */
export function formatAgentList(
  items: AgentListItem[],
  name: (id: string) => string
) {
  if (items.length === 0) return "No agents."
  const ids = items.map((item) => name(item.id))
  const states = items.map(listState)
  const idWidth = Math.max(...ids.map((id) => id.length))
  const stateWidth = Math.max(...states.map((state) => state.length))
  return items
    .map((item, index) => {
      const where = [
        item.cwd,
        item.worktreeBranch ? `branch ${item.worktreeBranch}` : "",
        item.parent ? `subagent of ${name(item.parent)}` : "",
      ]
        .filter(Boolean)
        .join(", ")
      const lines = [
        `${ids[index]!.padEnd(idWidth)}  ${states[index]!.padEnd(stateWidth)}  ${item.title} (${where})`,
      ]
      for (const line of item.running ?? [])
        lines.push(`${" ".repeat(idWidth + 2)}${line}`)
      return lines.join("\n")
    })
    .join("\n")
}

/** Where an agent works. */
export function formatPlace(info: AgentInfo) {
  return info.worktree
    ? `in worktree ${info.worktree.path} (branch ${info.worktree.branch})`
    : `in ${info.cwd}`
}

/** What a state means, for a sentence about agent `name`. */
export function formatWaitResult(
  name: string,
  result: WaitResult & { state: RunState },
  waitedSeconds?: number
) {
  const head = `Agent ${name} (${result.title})`
  switch (result.state) {
    case "done":
      return `${head} is done.\n\n${result.answer ?? "(no answer)"}`
    case "stopped":
      return `${head} stopped before it answered.`
    case "failed":
      return `${head} failed.\n\n${result.answer ?? ""}`.trim()
    case "needs_input":
      return `${head} waits for an answer from the user. Answer it in Pico, or send the answer as a steer message.`
    case "waiting":
      return `${head} waits on ${result.waiting ?? "a job"}. It goes on when that ends.`
    case "working":
      return [
        `${head} still works${waitedSeconds ? ` after ${waitedSeconds}s` : ""}.`,
        ...(result.running ?? []).map((line) => `Now: ${line}`),
      ].join("\n")
  }
}
