# Plan: Rename sessions to agents

Status: in progress (phases 1 to 4). Scope: the UI, the tools, the API, the code, and the docs. There is no backwards compatibility: old clients, old machines on the hub, and old tool names stop working. Saved user data stays readable.

## Glossary

Use these words everywhere: in UI text, tool names and descriptions, API routes, event types, code names, file names, tests, and docs.

| Concept                                                            | Old word             | New word                  |
| ------------------------------------------------------------------ | -------------------- | ------------------------- |
| The unit in the sidebar: an AI that works on a task, with a status | session              | **agent**                 |
| Its history (messages, tool calls, the tree)                       | session              | **conversation**          |
| An agent that another agent starts                                 | child session, child | **subagent**              |
| The agent that starts it                                           | parent session       | **parent** (parent agent) |
| The group in the sidebar that holds agents                         | directory            | **project**               |
| One prompt and the agent's work until it stops                     | run, turn            | **turn**                  |
| Worktree, machine, hub, job, terminal, profile, archive            | same                 | same                      |

## What does not change

1. **Persisted strings.** Renaming these loses user data, so keep the string and rename only the TypeScript name. Add a comment such as `// Stored name: do not change.`
   - Document kinds: `pico.session`, `pico.queue`, `pico.delivered`, and the others (`kind:` in `defineDoc`).
   - The public ID prefix `s` (`s12`). IDs are stored in `meta.parent`, in pi imports, in sidebar order, and in links in notifications. An ID is opaque, so the letter does not matter.
   - `localStorage` keys (`pico-pinned-sessions`, `pico-collapsed-directories`, …). They hold pins, collapsed projects, and recent projects.
2. **Names that pi or pi-durable owns.** `AgentSession`, `ConversationId`, `conversationId`, `harness.conversation()`, `scope: "session"` and `scope: "conversation"` in `defineDoc`, and pi's `AgentDoc`, `LiveDoc`, `InboxDoc`. Note that a Pico agent is a pi-durable conversation.
3. **Other meanings of the same words.** Do not rename these:
   - React `children` props, DOM `parentElement`, `firstElementChild`, `child_process`.
   - Tree nodes: the conversation tree (`/api/.../tree`), the file tree, git trees, and the sidebar tree code (`visibleChildrenById`, `isVirtualRootChild`, `childIndent`). Rename only where the node is a subagent.
   - Real filesystem directories: the working directory (`cwd`), the file browser, `/api/directory-search`, `/api/directory/resolve`, path completion.
   - Auth sessions in `server/src/core/auth.ts`, if there are any.
4. **Old plans** in `docs/plans/`. They are history.

## Name map

### Tools (`server/src/extensions/sessions.ts`, `server/src/core/profiles.ts`)

| Old                                      | New                            |
| ---------------------------------------- | ------------------------------ |
| `spawn_session`                          | `spawn_subagent`               |
| `send_to_session`                        | `agents` with `action: "send"` |
| `sessions`                               | `agents`                       |
| `sessions.stop`                          | `agents.stop`                  |
| `sessions.archive`                       | `agents.archive`               |
| `send_to_session` in profiles and limits | `agents.send`                  |
| `CHILD_DENIED_TOOLS`                     | `SUBAGENT_DENIED_TOOLS`        |

`send_to_session` is merged into the `agents` tool as the `send` action. It keeps all its arguments (`id`, `message`, `mode`, `wait`, `timeout`, `add`, `remove`, `machine`). `agents.send` is an action name, as `agents.stop` is: the `builder` profile removes it, the `reviewer` profile keeps it, and `WRITE_TOOLS` lists it. The other actions stay as they are.

Rewrite the tool descriptions and the prompt text for subagents (`childInstructions` → `subagentInstructions`): "You are a subagent of agent s12. Your parent gave you this work…". The model reads these words, so they must use the glossary.

### Settings (`server/src/core/settings.ts`)

| Old                | New                |
| ------------------ | ------------------ |
| `maxChildSessions` | `maxSubagents`     |
| `maxSpawnDepth`    | `maxSubagentDepth` |
| `notifyRunDone`    | `notifyTurnDone`   |

A saved value under an old key is dropped and the default applies. This is acceptable.

### API routes (`server/src/api.ts`, `server/src/machines/*`, `server/src/extensions/sessions.ts`)

| Old                                               | New                            |
| ------------------------------------------------- | ------------------------------ |
| `/api/session/*` (all 25)                         | `/api/agent/*`                 |
| `/api/sessions/archived`                          | `/api/agents/archived`         |
| `/api/sessions/delete`                            | `/api/agents/delete`           |
| `/api/directory-sessions`                         | `/api/project-agents`          |
| `/api/directory-sessions-index`                   | `/api/project-agents-index`    |
| `/api/directory-sessions-indexes`                 | `/api/project-agents-indexes`  |
| `/api/directory-sessions/cleanup`                 | `/api/project-agents/cleanup`  |
| `/api/machine/session/*`                          | `/api/machine/agent/*`         |
| `/api/machine/sessions`                           | `/api/machine/agents`          |
| `/api/machine/sessions/archived`                  | `/api/machine/agents/archived` |
| `/api/directory-search`, `/api/directory/resolve` | no change (filesystem)         |

Request and response fields follow the same rule: `sessionId` → `agentId`, `sessions` → `agents`, `children` → `subagents`, `directory` → `project` when it names the sidebar group (keep `cwd` and `path` for paths).

### Events and message types

| Old                         | New                       |
| --------------------------- | ------------------------- |
| `session_status`            | `agent_status`            |
| `session_done`              | `agent_done`              |
| `session_extensions`        | `agent_extensions`        |
| `sessions`                  | `agents`                  |
| `auto_session_naming_error` | `auto_agent_naming_error` |
| `new-session` (dialog)      | `new-agent`               |
| `add-directory` (dialog)    | `add-project`             |
| `pico:open-session` (DOM)   | `pico:open-agent`         |
| `pico:session-extensions`   | `pico:agent-extensions`   |

Check each `"session"` and `"directory"` literal (layout kinds, settings sections) one at a time.

### Code names

- `Session*` → `Agent*`, `session*` → `agent*`, `ChildSession` → `Subagent`, `child`/`children` → `subagent`/`subagents` (only where it is a subagent), `parent` stays.
- `SessionDoc` → `AgentMetaDoc`, and `SessionMeta` → `AgentMeta`. `AgentDoc` is taken by pi-durable.
- Before a rename, look for an `agent` name in the same scope. The code already uses `agent` (for example `const agent = await this.#doc(id, "agent")`). Rename the old name first (`agentState`) to prevent a clash.
- Directory names for the sidebar group: `directory*` → `project*` (`sidebar-directories`, `collapsed-directories`, `add-directory-dialog`).

### Files

| Old                                                    | New                                                  |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `server/src/core/sessions.ts`                          | `server/src/core/agents.ts`                          |
| `server/src/extensions/sessions.ts`                    | `server/src/extensions/agents.ts`                    |
| `server/test/child-sessions.test.ts`                   | `server/test/subagents.test.ts`                      |
| `server/test/extensions-sessions.test.ts`              | `server/test/extensions-agents.test.ts`              |
| `server/test/session-switch.test.ts`                   | `server/test/agent-switch.test.ts`                   |
| `src/features/pico/agent/children.tsx`                 | `src/features/pico/agent/subagents.tsx`              |
| `src/features/pico/agent/session-extensions.ts`        | `src/features/pico/agent/agent-extensions.ts`        |
| `src/features/pico/agent/session-lineage.tsx`          | `src/features/pico/agent/agent-lineage.tsx`          |
| `src/features/pico/app-shell-session-*.tsx`            | `src/features/pico/app-shell-agent-*.tsx`            |
| `src/features/pico/app-shell-sessions-dialog.tsx`      | `src/features/pico/app-shell-agents-dialog.tsx`      |
| `src/features/pico/app-shell-add-directory-dialog.tsx` | `src/features/pico/app-shell-add-project-dialog.tsx` |
| `src/features/pico/archived-sessions-dialog.tsx`       | `src/features/pico/archived-agents-dialog.tsx`       |
| `src/features/pico/other-machine-session-dialogs.tsx`  | `src/features/pico/other-machine-agent-dialogs.tsx`  |
| `src/features/pico/session-*.ts`                       | `src/features/pico/agent-*.ts`                       |
| `src/features/pico/sidebar-session-numbers.ts`         | `src/features/pico/sidebar-agent-numbers.ts`         |
| `src/features/pico/use-app-shell-session-*.ts`         | `src/features/pico/use-app-shell-agent-*.ts`         |

Use `git mv`, so git keeps the history.

### UI text

- "New session" → "New agent", "Rename session" → "Rename agent", "Archive session" → "Archive agent", "Session menu" → "Agent menu".
- "Compact session" → "Compact conversation". Fork and the tree are also about the conversation.
- "Move session" → "Move agent", "Move this session to this directory" → "Move this agent to this project".
- "Archived sessions", "No archived sessions", "Filter archived sessions…" → the same with "agents".
- "Show all sessions", "No sessions with this state" → "agents".
- "Session streaming", "Session done" → "Agent working", "Agent done".
- "Show session previews" → "Show agent previews".
- "Session completion notifications", "when a session finishes" → "Turn completion notifications", "when an agent finishes its turn".
- "child sessions" → "subagents". The Agent tab lists "Subagents".
- "Add directory" → "Add project", when it adds a sidebar group.

The "Agent pane" and the "Agent tab" keep their names. They show the current agent.

## Phases

Phases 1 and 2 touch different directories, so two subagents can do them at the same time, each in its own worktree. The name map above is the contract between them.

### Phase 1: Server (`apps/pico/server/**`)

1. Rename the files with `git mv`.
2. Rename the tools, the actions, the profiles, the subagent prompt, and the settings.
3. Rename the API routes, the request and response fields, and the event types.
4. Rename the code names. Keep the persisted strings (see "What does not change").
5. Update the tests, and add a test that the old tool names are gone from the tool list.
6. Run `pnpm --filter @pico/server typecheck` and `pnpm test`.

### Phase 2: Web client (`apps/pico/src/**`, `apps/pico/scripts/**`)

1. Rename the files with `git mv`, and fix the imports.
2. Change the API calls and event types to the new routes and names.
3. Change the tool renderers: `registerToolRenderer("spawn_subagent", …)` and `"agents"`. The `agents` renderer also draws the `send` action, as `send_to_session` was drawn before. Remove the renderers for old tool names. Old transcripts then show the generic card.
4. Rename the code names and the DOM event names. Keep the `localStorage` keys.
5. Change the UI text and the command palette keywords.
6. Run `pnpm exec vp fmt` and `pnpm exec vp lint` on the changed files.

### Phase 3: Merge and check

1. Merge phase 1, then phase 2, into one branch.
2. Run `pnpm check` from the repo root.
3. Search for old words that remain, and look at each match:
   `rg -i -w "sessions?|child(ren)?|directory|directories" apps/pico/src apps/pico/server/src apps/pico/server/test`
4. Run Pico from `pnpm dev`. Test: create an agent, rename it, archive and restore it, spawn a subagent in a worktree, send it a message, wait for its report, compact a conversation, move an agent to another project, and use another machine through the hub.

### Phase 4: Docs

1. `README.md`: the feature list, the tool names, and the screenshot alt text.
2. `apps/website/site/index.html`.
3. `AGENTS.md` (this repo) and `~/.pi/agent/AGENTS.md`: rename the "Child sessions" section to "Subagents".
4. Format with `pnpm exec vp fmt -c apps/pico/vite.config.ts <files>`, and deploy the website with `pnpm website:deploy`.

### Phase 5: Release

This is a breaking change. Release a new major version. Update all machines on the hub at the same time, because a machine with the old API cannot talk to one with the new API.

## Risks

- **Size.** About 8,000 matches for `session`, 2,200 for `directory`, and 900 for `child`. Do not use a blind search and replace. Use the rules in "What does not change". Rename one name at a time, and let `tsc` and `vp lint` (which type-checks) find each use.
- **Persisted data.** A changed document kind or ID prefix hides all saved agents. Phase 3 must start Pico on a copy of a real data directory (`pnpm start --data-dir`) and check that all agents, names, parents, and projects are still there.
- **Missed strings.** A route or event name that one side changes and the other does not fails only at run time. The search in phase 3 and the manual test catch these.
